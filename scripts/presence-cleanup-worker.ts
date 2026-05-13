/**
 * Presence cleanup worker — deletes stale heartbeat rows so the
 * `presence_heartbeats` table doesn't grow forever. Runs every 5 minutes
 * and prunes anything older than 24 hours.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const INTERVAL_MS = parseInt(
  process.env.PRESENCE_CLEANUP_INTERVAL_MS ?? "300000", // 5 minutes
  10,
);
const MAX_AGE_MS = parseInt(
  process.env.PRESENCE_CLEANUP_MAX_AGE_MS ?? "86400000", // 24 hours
  10,
);

async function tick() {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  const result = await db.presenceHeartbeat.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info("presence-cleanup-worker: pruned stale heartbeats", {
      count: result.count,
    });
  }
}

async function main() {
  logger.info("presence-cleanup-worker started", {
    intervalMs: INTERVAL_MS,
    maxAgeMs: MAX_AGE_MS,
  });

  await tick();
  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("presence-cleanup-worker: tick error", err),
    );
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`presence-cleanup-worker: received ${signal}, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("presence-cleanup-worker: fatal startup error", err);
  process.exit(1);
});
