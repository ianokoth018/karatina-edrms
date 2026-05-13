/**
 * Storage-tier worker — applies the tiering policy once a day, off-hours.
 *
 * Tiering IO can touch a lot of files in one pass (hot→warm or warm→archive),
 * so we deliberately gate it to 02:00 local. Set DEBUG=1 to skip the gate
 * and run immediately, useful for local development.
 */

import { applyTieringPolicy } from "@/lib/storage-tier";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Re-check every 6 hours so we naturally land in the 02:00 window once per day.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEBUG = process.env.DEBUG === "1";

/** Milliseconds from `now` until the next 02:00 local. */
function msUntilNextOffHours(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function isOffHours(now: Date = new Date()): boolean {
  const h = now.getHours();
  // 22:00–05:59 local — quiet enough that bulk IO won't impact users.
  return h >= 22 || h < 6;
}

async function tick() {
  if (!DEBUG && !isOffHours()) {
    const wait = msUntilNextOffHours();
    logger.info("storage-tier-worker: business hours, deferring", {
      nextRunInMs: wait,
      nextRunAt: new Date(Date.now() + wait).toISOString(),
    });
    return;
  }
  const start = Date.now();
  try {
    const result = await applyTieringPolicy();
    logger.info("storage-tier-worker: pass complete", {
      ...result,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logger.error("storage-tier-worker: pass failed", err);
  }
}

async function main() {
  const nextRun = DEBUG ? "now (DEBUG=1)" : new Date(Date.now() + msUntilNextOffHours()).toISOString();
  logger.info("storage-tier-worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    debug: DEBUG,
    nextRun,
  });

  // First tick — respects the off-hours gate unless DEBUG=1.
  await tick();
  const timer = setInterval(() => {
    tick().catch((err) => logger.error("storage-tier-worker: tick error", err));
  }, POLL_INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`storage-tier-worker: received ${signal}, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("storage-tier-worker: fatal startup error", err);
  process.exit(1);
});
