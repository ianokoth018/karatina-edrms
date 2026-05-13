/**
 * Scheduled backup worker.
 *
 * - Runs a single backup at 02:00 local each day.
 * - Tags it daily / weekly (Sundays) / monthly (1st of the month).
 * - Applies retention: keep last 7 daily, 4 weekly, 12 monthly.
 *   Anything that no longer falls inside any of those windows is removed
 *   from disk and from the BackupLog table.
 *
 * Set DEBUG=1 to skip the 02:00 gate and run a backup immediately on
 * startup — handy for local validation. The retention pass also runs on
 * every tick after a successful backup.
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  type BackupType,
  resolveBackupDir,
  runBackup,
} from "@/lib/backup";

const POLL_INTERVAL_MS = 30 * 60 * 1000; // every 30 min, sloppy enough to catch 02:00
const DEBUG = process.env.DEBUG === "1";

const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const KEEP_MONTHLY = 12;

interface SchedulerState {
  lastRunDay: string | null;
}
const state: SchedulerState = { lastRunDay: null };

function localDayKey(d: Date = new Date()): string {
  // Local-date YYYY-MM-DD — used to make sure we only fire once per day even
  // if the worker is restarted around the trigger time.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isTriggerHour(d: Date = new Date()): boolean {
  return d.getHours() === 2;
}

function backupTypeFor(d: Date = new Date()): BackupType {
  const day = d.getDate();
  const dow = d.getDay(); // 0 = Sunday
  if (day === 1) return "monthly";
  if (dow === 0) return "weekly";
  return "daily";
}

async function runOnce(type: BackupType): Promise<void> {
  const start = Date.now();
  logger.info("backup-worker: starting run", { type });
  try {
    const { manifest } = await runBackup({ type });
    const durationMs = Date.now() - start;
    await db.backupLog.create({
      data: {
        type,
        dbDumpPath: manifest.dbDumpPath,
        uploadsPath: manifest.uploadsPath,
        dbBytes: BigInt(manifest.dbSize),
        uploadsBytes: BigInt(manifest.uploadsSize),
        durationMs,
        status: "SUCCESS",
      },
    });
    logger.info("backup-worker: run complete", {
      type,
      durationMs,
      dbSize: manifest.dbSize,
      uploadsSize: manifest.uploadsSize,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logger.error("backup-worker: run failed", err, { type, durationMs });
    await db.backupLog
      .create({
        data: { type, durationMs, status: "FAILED", error: message },
      })
      .catch((logErr) =>
        logger.error("backup-worker: also failed to write BackupLog", logErr)
      );
  }
}

/**
 * Apply retention. We never touch FAILED rows — those are kept for audit.
 * Per-bucket: keep the N most-recent SUCCESS rows of each type. Any
 * SUCCESS row outside every bucket has its files unlinked and its row
 * deleted.
 */
async function applyRetention(): Promise<void> {
  const buckets: Array<{ type: BackupType; keep: number }> = [
    { type: "daily", keep: KEEP_DAILY },
    { type: "weekly", keep: KEEP_WEEKLY },
    { type: "monthly", keep: KEEP_MONTHLY },
  ];
  const keepIds = new Set<string>();

  for (const b of buckets) {
    const rows = await db.backupLog.findMany({
      where: { type: b.type, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
      take: b.keep,
      select: { id: true },
    });
    for (const r of rows) keepIds.add(r.id);
  }

  // Manual + FAILED rows are always preserved.
  const candidates = await db.backupLog.findMany({
    where: {
      status: "SUCCESS",
      type: { in: ["daily", "weekly", "monthly"] },
    },
    select: { id: true, dbDumpPath: true, uploadsPath: true, type: true },
  });

  for (const row of candidates) {
    if (keepIds.has(row.id)) continue;
    for (const p of [row.dbDumpPath, row.uploadsPath]) {
      if (!p) continue;
      try {
        await fs.unlink(p);
      } catch (err) {
        // ENOENT is fine — the file may already be gone.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          logger.warn("backup-worker: failed to unlink", { path: p, code });
        }
      }
    }
    // Best-effort: also unlink the sibling manifest file.
    if (row.dbDumpPath) {
      const stamp = path.basename(row.dbDumpPath).replace(/^db-/, "").replace(/\.dump$/, "");
      const manifest = path.join(path.dirname(row.dbDumpPath), `manifest-${stamp}.json`);
      try { await fs.unlink(manifest); } catch { /* ignore */ }
    }
    await db.backupLog.delete({ where: { id: row.id } });
    logger.info("backup-worker: pruned", { id: row.id, type: row.type });
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const dayKey = localDayKey(now);
  const inWindow = DEBUG || isTriggerHour(now);
  if (!inWindow) return;
  if (state.lastRunDay === dayKey) return;
  state.lastRunDay = dayKey;
  const type = backupTypeFor(now);
  await runOnce(type);
  try {
    await applyRetention();
  } catch (err) {
    logger.error("backup-worker: retention failed", err);
  }
}

async function main(): Promise<void> {
  logger.info("backup-worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    backupDir: resolveBackupDir(),
    keep: { daily: KEEP_DAILY, weekly: KEEP_WEEKLY, monthly: KEEP_MONTHLY },
    debug: DEBUG,
  });

  await tick().catch((err) =>
    logger.error("backup-worker: initial tick error", err)
  );

  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("backup-worker: tick error", err)
    );
  }, POLL_INTERVAL_MS);

  async function shutdown(signal: string): Promise<void> {
    logger.info(`backup-worker: received ${signal}, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("backup-worker: fatal startup error", err);
  process.exit(1);
});
