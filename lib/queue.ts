/**
 * pg-boss job queue — persistent background processing using PostgreSQL.
 *
 * pg-boss auto-creates its own schema (`pgboss.*`) on first start.
 * The DATABASE_URL env var is the same one Prisma uses.
 *
 * Jobs are crash-safe: if the process dies, pg-boss retries on restart.
 */

import { createRequire } from "module";
import type { PgBoss as PgBossType } from "pg-boss";
import { logger } from "@/lib/logger";

// pg-boss CJS exports { PgBoss } as a named export, not a default
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PgBoss = (_require("pg-boss") as any).PgBoss as typeof PgBossType;

export const OCR_QUEUE = "ocr";

let boss: PgBossType | null = null;
let starting: Promise<PgBossType> | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // pg-boss uses the pg driver which handles percent-encoded URLs natively
  return url;
}

function getPgConfig() {
  const url = new URL(getConnectionString());
  return {
    host: url.hostname,
    port: parseInt(url.port || "5432", 10),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/**
 * Get (or lazily start) the shared pg-boss instance.
 * Safe to call from multiple modules — returns the same instance.
 */
export async function getBoss(): Promise<PgBossType> {
  if (boss) return boss;
  if (starting) return starting;

  starting = (async () => {
    const instance = new PgBoss({
      ...getPgConfig(),
      // Retry failed OCR jobs up to 3 times with exponential back-off
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      // Delete completed jobs after 7 days (v12 option name)
      deleteAfterSeconds: 60 * 60 * 24 * 7,
      // Run maintenance every 30 s
      maintenanceIntervalSeconds: 30,
    });

    instance.on("error", (err: unknown) => {
      // Properly extract message from Error, AggregateError, or plain objects
      let detail: string;
      if (err instanceof AggregateError) {
        detail = err.errors.map((e: unknown) => (e instanceof Error ? e.message : String(e))).join(" | ");
      } else if (err instanceof Error) {
        detail = err.message;
      } else {
        try { detail = JSON.stringify(err); } catch { detail = String(err); }
      }
      logger.error(`pg-boss error: ${detail}`, err instanceof Error ? err : undefined, { queue: "pg-boss" });
    });

    await instance.start();
    boss = instance;
    logger.info("pg-boss started", { queue: "pg-boss" });
    return instance;
  })();

  return starting;
}

/**
 * Enqueue an OCR job for a DocumentFile.
 * Returns the job id (string uuid) or null if enqueueing fails.
 */
export async function enqueueOcr(
  fileId: string,
  opts: { priority?: number } = {}
): Promise<string | null> {
  try {
    const b = await getBoss();
    await b.createQueue(OCR_QUEUE); // idempotent — safe to call if queue already exists
    const jobId = await b.send(OCR_QUEUE, { fileId }, {
      // Deduplicate: don't re-queue if a job for this fileId is already pending
      singletonKey: fileId,
      singletonSeconds: 300, // only one job per fileId within 5 min window
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(opts.priority ? { priority: opts.priority } as any : {}),
    });
    logger.info("OCR job enqueued", { fileId, jobId });
    return jobId;
  } catch (err) {
    logger.error("Failed to enqueue OCR job", err, { fileId });
    // Fallback: fire-and-forget so OCR still happens even if queue fails
    const { processFileOcr } = await import("@/lib/ocr");
    setImmediate(() => processFileOcr(fileId).catch(() => {}));
    return null;
  }
}

/**
 * Start the OCR worker. Call this once from a long-running process
 * (e.g., capture-worker.ts or a dedicated worker script).
 *
 * Concurrency = 3: at most 3 OCR jobs run in parallel.
 */
export async function startOcrWorker(): Promise<void> {
  const { processFileOcr } = await import("@/lib/ocr");
  const b = await getBoss();

  // pg-boss v12 requires explicit queue creation before workers can poll it
  await b.createQueue(OCR_QUEUE);

  await b.work(OCR_QUEUE, { localConcurrency: 3 }, async (job) => {
    const { fileId } = job.data as { fileId: string };
    logger.info("Processing OCR job", { fileId, jobId: job.id });
    await processFileOcr(fileId);
  });

  logger.info("OCR worker started", { concurrency: 3 });
}

/**
 * Gracefully stop pg-boss (call on process SIGTERM/SIGINT).
 */
export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
    starting = null;
    logger.info("pg-boss stopped");
  }
}
