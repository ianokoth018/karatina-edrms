/**
 * Bulk-import worker — polls every 30 seconds for PENDING BulkImportJob rows
 * and runs them sequentially (one job at a time, no per-job parallelism).
 *
 * On startup we also recover any RUNNING jobs whose worker died mid-flight:
 * they're flipped back to PENDING so this worker can resume them. Each file
 * is dedup'd on contentHash inside `runImportJob`, so resuming is safe.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runImportJob } from "@/lib/bulk-import";

const POLL_INTERVAL_MS = 30 * 1000;

let stopping = false;
let pollTimer: NodeJS.Timeout | null = null;

async function recoverOrphanRunningJobs(): Promise<void> {
  try {
    const result = await db.bulkImportJob.updateMany({
      where: { status: "RUNNING" },
      data: { status: "PENDING" },
    });
    if (result.count > 0) {
      logger.warn("bulk-import-worker: recovered orphan RUNNING jobs", {
        count: result.count,
      });
    }
  } catch (err) {
    logger.error("bulk-import-worker: orphan recovery failed", err);
  }
}

async function processNextJob(): Promise<boolean> {
  const job = await db.bulkImportJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!job) return false;

  logger.info("bulk-import-worker: picked up job", { jobId: job.id, name: job.name });
  try {
    await runImportJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("bulk-import-worker: job failed", err, { jobId: job.id });
    try {
      await db.bulkImportJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: message.slice(0, 1000),
        },
      });
    } catch {
      /* nothing more we can do */
    }
  }
  return true;
}

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    // Drain all queued jobs sequentially before sleeping again.
    while (!stopping) {
      const ran = await processNextJob();
      if (!ran) break;
    }
  } catch (err) {
    logger.error("bulk-import-worker: tick error", err);
  }
}

async function main(): Promise<void> {
  logger.info("bulk-import-worker started", { pollIntervalMs: POLL_INTERVAL_MS });
  await recoverOrphanRunningJobs();
  await tick();

  pollTimer = setInterval(() => {
    tick().catch((err) => logger.error("bulk-import-worker: setInterval tick failed", err));
  }, POLL_INTERVAL_MS);

  async function shutdown(signal: string): Promise<void> {
    logger.info(`bulk-import-worker: received ${signal}, shutting down`);
    stopping = true;
    if (pollTimer) clearInterval(pollTimer);
    try {
      await db.$disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("bulk-import-worker: fatal startup error", err);
  process.exit(1);
});
