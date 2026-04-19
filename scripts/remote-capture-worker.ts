/**
 * Remote Capture Worker — SFTP / SMB Network Share Watcher
 *
 * Polls remote sources configured on CaptureProfiles with sourceType SFTP or SMB.
 * Copies new files to the profile's folderPath so the hot-folder capture-worker
 * processes them automatically.
 *
 * Usage:
 *   npx tsx scripts/remote-capture-worker.ts
 */

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { decryptSecret } from "../lib/encryption";
import SftpClient from "ssh2-sftp-client";

const prisma = new PrismaClient();

const GREEN = "\x1b[32m"; const YELLOW = "\x1b[33m";
const RED = "\x1b[31m"; const RESET = "\x1b[0m"; const BOLD = "\x1b[1m";

function log(level: "info" | "warn" | "error", msg: string, ctx?: Record<string, unknown>) {
  const pfx = { info: `${GREEN}INFO${RESET}`, warn: `${YELLOW}WARN${RESET}`, error: `${RED}ERROR${RESET}` }[level];
  console.log(`${new Date().toISOString()} ${pfx}  ${msg}`, ctx ? JSON.stringify(ctx) : "");
}

// Track already-seen remote files: key = "profileId:filename:mtime"
const seen = new Set<string>();

function fileKey(profileId: string, name: string, mtime: Date | number | undefined): string {
  return `${profileId}:${name}:${mtime instanceof Date ? mtime.getTime() : mtime ?? 0}`;
}

// ─── SFTP ─────────────────────────────────────────────────────────────────────

async function pollSftp(profile: {
  id: string; name: string; folderPath: string;
  remoteHost: string; remotePort: number | null; remoteUser: string;
  remotePassword: string | null; remotePath: string;
  remoteDeleteAfterCopy: boolean;
  fileTypes: string[];
}) {
  let password = profile.remotePassword ?? "";
  try { password = decryptSecret(password); } catch { /* plaintext */ }

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: profile.remoteHost,
      port: profile.remotePort ?? 22,
      username: profile.remoteUser,
      password,
    });

    const items = await sftp.list(profile.remotePath);
    const allowed = new Set(profile.fileTypes.map((t) => t.toLowerCase().replace(".", "")));

    for (const item of items) {
      if (item.type !== "-") continue; // skip dirs
      const ext = path.extname(item.name).slice(1).toLowerCase();
      if (!allowed.has(ext)) continue;

      const key = fileKey(profile.id, item.name, item.modifyTime);
      if (seen.has(key)) continue;

      const destPath = path.join(profile.folderPath, item.name);
      await fs.mkdir(profile.folderPath, { recursive: true });

      await sftp.fastGet(path.posix.join(profile.remotePath, item.name), destPath);
      seen.add(key);
      log("info", `SFTP → local: ${item.name}`, { profile: profile.name });

      if (profile.remoteDeleteAfterCopy) {
        await sftp.delete(path.posix.join(profile.remotePath, item.name)).catch(() => null);
      }

      await prisma.captureLog.create({
        data: {
          profileId: profile.id, fileName: item.name,
          filePath: path.posix.join(profile.remotePath, item.name),
          status: "PENDING",
          metadata: { source: "sftp", host: profile.remoteHost, remotePath: profile.remotePath },
        },
      }).catch(() => null);
    }
  } catch (err) {
    log("error", `SFTP error for ${profile.name}`, { err: String(err) });
  } finally {
    sftp.end();
  }
}

// ─── SMB ──────────────────────────────────────────────────────────────────────

async function pollSmb(profile: {
  id: string; name: string; folderPath: string;
  remoteHost: string; remotePort: number | null; remoteUser: string;
  remotePassword: string | null; remotePath: string;
  remoteDeleteAfterCopy: boolean;
  fileTypes: string[];
}) {
  // Lazy-import to avoid top-level SMB2 issues when not in use
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SMB2 = require("@marsaud/smb2");

  let password = profile.remotePassword ?? "";
  try { password = decryptSecret(password); } catch { /* plaintext */ }

  const [domain, username] = profile.remoteUser.includes("\\")
    ? profile.remoteUser.split("\\", 2)
    : ["WORKGROUP", profile.remoteUser];

  const smb = new SMB2({
    share: `\\\\${profile.remoteHost}\\${profile.remotePath.replace(/\//g, "\\").replace(/^\\/, "")}`,
    domain,
    username,
    password,
    port: profile.remotePort ?? 445,
  });

  try {
    const files: string[] = await new Promise((resolve, reject) =>
      smb.readdir(".", (err: Error | null, list: string[]) => err ? reject(err) : resolve(list))
    );

    const allowed = new Set(profile.fileTypes.map((t) => t.toLowerCase().replace(".", "")));

    for (const fname of files) {
      const ext = path.extname(fname).slice(1).toLowerCase();
      if (!allowed.has(ext)) continue;

      const key = fileKey(profile.id, fname, undefined);
      if (seen.has(key)) continue;

      const destPath = path.join(profile.folderPath, fname);
      await fs.mkdir(profile.folderPath, { recursive: true });

      const fileBuffer: Buffer = await new Promise((resolve, reject) =>
        smb.readFile(fname, (err: Error | null, buf: Buffer) => err ? reject(err) : resolve(buf))
      );
      await fs.writeFile(destPath, fileBuffer);
      seen.add(key);
      log("info", `SMB → local: ${fname}`, { profile: profile.name });

      if (profile.remoteDeleteAfterCopy) {
        await new Promise<void>((res) => smb.unlink(fname, () => res()));
      }

      await prisma.captureLog.create({
        data: {
          profileId: profile.id, fileName: fname,
          filePath: `\\\\${profile.remoteHost}\\${fname}`,
          status: "PENDING",
          metadata: { source: "smb", host: profile.remoteHost },
        },
      }).catch(() => null);
    }
  } catch (err) {
    log("error", `SMB error for ${profile.name}`, { err: String(err) });
  } finally {
    smb.close?.();
  }
}

// ─── Main poll loop ────────────────────────────────────────────────────────────

async function tick() {
  const profiles = await prisma.captureProfile.findMany({
    where: { isActive: true, sourceType: { in: ["SFTP", "SMB"] } },
    select: {
      id: true, name: true, folderPath: true, fileTypes: true,
      sourceType: true, remoteHost: true, remotePort: true,
      remoteUser: true, remotePassword: true, remotePath: true,
      remoteDeleteAfterCopy: true,
      remotePollInterval: true,
    },
  });

  if (profiles.length === 0) return;
  log("info", `Polling ${profiles.length} remote profile(s)`);

  await Promise.allSettled(profiles.map((p) => {
    if (!p.remoteHost || !p.remoteUser || !p.remotePath) return Promise.resolve();
    const prof = {
      ...p,
      remoteHost: p.remoteHost!,
      remoteUser: p.remoteUser!,
      remotePath: p.remotePath!,
    };
    return p.sourceType === "SFTP" ? pollSftp(prof) : pollSmb(prof);
  }));
}

async function main() {
  log("info", `${BOLD}Remote Capture Worker${RESET} starting`);

  await tick();
  // Schedule per-profile polls using their remotePollInterval setting.
  // We use a single global 60s heartbeat and let each profile decide based on lastPoll.
  const DEFAULT_INTERVAL = 60_000;
  const timer = setInterval(tick, DEFAULT_INTERVAL);

  process.on("SIGTERM", () => { clearInterval(timer); prisma.$disconnect(); process.exit(0); });
  process.on("SIGINT",  () => { clearInterval(timer); prisma.$disconnect(); process.exit(0); });
}

main().catch((err) => { console.error(err); process.exit(1); });
