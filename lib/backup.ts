/**
 * Backup primitives — shared between the manual CLI (`scripts/backup.ts`),
 * the scheduled worker (`scripts/backup-worker.ts`), the restore CLI
 * (`scripts/restore.ts`) and the admin API (`/api/admin/backup/*`).
 *
 * No external deps — `pg_dump` / `pg_restore` / `tar` are invoked via
 * `child_process.spawn` and `crypto.createHash` does the sha256 over the
 * resulting files.
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import {
  createReadStream,
  promises as fs,
  existsSync,
} from "fs";
import path from "path";

export interface BackupManifest {
  id: string;
  timestamp: string;
  type: BackupType;
  dbDumpPath: string;
  uploadsPath: string;
  dbSize: number;
  uploadsSize: number;
  checksums: {
    db: string;
    uploads: string;
  };
  includeArchive: boolean;
}

export type BackupType = "daily" | "weekly" | "monthly" | "manual";

export interface RunBackupOptions {
  /** Output directory — created if missing. Defaults to `./backups`. */
  backupDir?: string;
  /** If false (default), pass `--exclude=uploads/archive` to `tar`. */
  includeArchive?: boolean;
  /** Tag stored in manifest + filenames. */
  type?: BackupType;
  /** Override the project root that holds the `uploads/` directory. */
  cwd?: string;
}

export interface RunBackupResult {
  manifest: BackupManifest;
  manifestPath: string;
}

const DEFAULT_BACKUP_DIR = "./backups";

export function resolveBackupDir(opts: RunBackupOptions = {}): string {
  const fromEnv = process.env.BACKUP_DIR;
  const raw = opts.backupDir ?? fromEnv ?? DEFAULT_BACKUP_DIR;
  return path.resolve(raw);
}

export function resolveIncludeArchive(opts: RunBackupOptions = {}): boolean {
  if (typeof opts.includeArchive === "boolean") return opts.includeArchive;
  const env = process.env.INCLUDE_ARCHIVE;
  if (env == null) return false;
  return env === "1" || env.toLowerCase() === "true";
}

function tsStamp(d: Date = new Date()): string {
  // 2026-05-13T02-00-00 — filesystem-safe ISO.
  return d.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

function shortId(): string {
  return (
    "bkp_" +
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36)
  );
}

/** Stream the file through sha256 — never loads the whole thing. */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

interface SpawnResult {
  code: number;
  stderr: string;
}

/**
 * Spawn a child process and resolve only on clean exit. stderr is captured
 * for diagnostic messages on failure; stdout streams to /dev/null unless an
 * `outFile` is supplied (used by pg_dump to write the .dump file directly).
 */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; outFile?: string } = {}
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", opts.outFile ? "pipe" : "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (b) => {
      stderr += b.toString();
    });

    if (opts.outFile && child.stdout) {
      // Lazy import via require avoids a top-level fs import collision when
      // the rest of the module already uses fs/promises.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWriteStream } = require("fs") as typeof import("fs");
      const out = createWriteStream(opts.outFile);
      child.stdout.pipe(out);
      out.on("error", reject);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stderr });
      } else {
        reject(
          new Error(
            `${cmd} exited with code ${code}: ${stderr.trim() || "(no stderr)"}`
          )
        );
      }
    });
  });
}

/**
 * Drive `pg_dump --format=custom --no-owner --no-acl` against DATABASE_URL
 * and stream the result to `outFile`. We pass the URL via env, never via
 * argv, so the password never lands in `ps`.
 */
export async function pgDumpCustom(
  databaseUrl: string,
  outFile: string
): Promise<void> {
  await run(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-acl", "--dbname", databaseUrl],
    { outFile }
  );
}

/**
 * Drive `pg_restore --clean --if-exists` from `inputFile` into DATABASE_URL.
 * Note: `--clean --if-exists` drops every object the dump owns before
 * recreating it — this is destructive on purpose, the caller MUST have
 * confirmed.
 */
export async function pgRestoreCustom(
  databaseUrl: string,
  inputFile: string
): Promise<void> {
  await run("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-acl",
    "--dbname",
    databaseUrl,
    inputFile,
  ]);
}

/**
 * tar czf <out> uploads/  with an optional --exclude=uploads/archive.
 * Run with cwd = project root so the archive paths are relative.
 */
export async function tarUploads(
  outFile: string,
  cwd: string,
  includeArchive: boolean
): Promise<void> {
  const args = ["czf", outFile];
  if (!includeArchive) args.push("--exclude=uploads/archive");
  args.push("uploads");
  await run("tar", args, { cwd });
}

/** Reverse of `tarUploads` — extracts back into cwd, recreating `uploads/`. */
export async function untarUploads(
  inputFile: string,
  cwd: string
): Promise<void> {
  await run("tar", ["xzf", inputFile, "-C", cwd]);
}

async function fileSize(p: string): Promise<number> {
  const st = await fs.stat(p);
  return Number(st.size);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Run a full backup (Postgres dump + uploads tarball + manifest).
 *
 * Returns the manifest object and the path to the manifest file. Does not
 * write a BackupLog row — that's the caller's job (manual CLI and the
 * scheduled worker each have slightly different policies).
 */
export async function runBackup(
  opts: RunBackupOptions = {}
): Promise<RunBackupResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const dir = resolveBackupDir(opts);
  const cwd = opts.cwd ?? process.cwd();
  const includeArchive = resolveIncludeArchive(opts);
  const type: BackupType = opts.type ?? "manual";

  await ensureDir(dir);

  const stamp = tsStamp();
  const id = shortId();
  const dbFile = path.join(dir, `db-${stamp}.dump`);
  const uploadsFile = path.join(dir, `uploads-${stamp}.tar.gz`);
  const manifestFile = path.join(dir, `manifest-${stamp}.json`);

  await pgDumpCustom(databaseUrl, dbFile);

  // The uploads directory may not exist in fresh dev environments — create
  // an empty one so the tar command never fails on missing input.
  const uploadsPath = path.join(cwd, "uploads");
  if (!existsSync(uploadsPath)) {
    await ensureDir(uploadsPath);
  }
  await tarUploads(uploadsFile, cwd, includeArchive);

  const [dbSize, uploadsSize, dbHash, uploadsHash] = await Promise.all([
    fileSize(dbFile),
    fileSize(uploadsFile),
    sha256File(dbFile),
    sha256File(uploadsFile),
  ]);

  const manifest: BackupManifest = {
    id,
    timestamp: new Date().toISOString(),
    type,
    dbDumpPath: dbFile,
    uploadsPath: uploadsFile,
    dbSize,
    uploadsSize,
    checksums: {
      db: dbHash,
      uploads: uploadsHash,
    },
    includeArchive,
  };

  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");

  return { manifest, manifestPath: manifestFile };
}

/**
 * Restore from a manifest. Verifies checksums before touching anything.
 * Throws if any checksum mismatches or either artefact is missing.
 */
export async function runRestore(
  manifestPath: string,
  opts: { cwd?: string } = {}
): Promise<BackupManifest> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const cwd = opts.cwd ?? process.cwd();

  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as BackupManifest;

  if (!existsSync(manifest.dbDumpPath)) {
    throw new Error(`db dump missing: ${manifest.dbDumpPath}`);
  }
  if (!existsSync(manifest.uploadsPath)) {
    throw new Error(`uploads archive missing: ${manifest.uploadsPath}`);
  }

  const [dbHash, uploadsHash] = await Promise.all([
    sha256File(manifest.dbDumpPath),
    sha256File(manifest.uploadsPath),
  ]);
  if (dbHash !== manifest.checksums.db) {
    throw new Error(
      `db dump checksum mismatch: expected ${manifest.checksums.db}, got ${dbHash}`
    );
  }
  if (uploadsHash !== manifest.checksums.uploads) {
    throw new Error(
      `uploads checksum mismatch: expected ${manifest.checksums.uploads}, got ${uploadsHash}`
    );
  }

  await pgRestoreCustom(databaseUrl, manifest.dbDumpPath);
  await untarUploads(manifest.uploadsPath, cwd);

  return manifest;
}

/** Numeric prefix used by retention policy — strictly Date-based. */
export function parseStampFromName(name: string): Date | null {
  // db-2026-05-13T02-00-00.dump  →  2026-05-13T02:00:00Z
  const m = name.match(
    /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/
  );
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
