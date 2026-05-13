/**
 * Scheduled-triggers worker — polls every 60 seconds for WorkflowTriggers
 * with triggerType === "scheduled" and nextFireAt <= now, then auto-starts
 * a workflow instance for each. Cron evaluation lives in lib/cron.ts.
 *
 * Designed to run alongside the other workers in package.json's
 * `start:workers` chain. SIGINT / SIGTERM shut it down cleanly.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { evaluateScheduledTriggers } from "@/lib/workflow-triggers";

const INTERVAL_MS = parseInt(
  process.env.SCHEDULED_TRIGGERS_INTERVAL_MS ?? "60000",
  10
);

async function tick() {
  try {
    const ids = await evaluateScheduledTriggers();
    if (ids.length > 0) {
      logger.info("scheduled-triggers-worker: fired", {
        count: ids.length,
        instanceIds: ids,
      });
    }
  } catch (err) {
    logger.error("scheduled-triggers-worker: tick failed", err);
  }
}

async function main() {
  logger.info("scheduled-triggers-worker started", { intervalMs: INTERVAL_MS });

  await tick();
  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("scheduled-triggers-worker: tick error", err)
    );
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`scheduled-triggers-worker: ${signal} received, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("scheduled-triggers-worker: fatal error", err);
  process.exit(1);
});
