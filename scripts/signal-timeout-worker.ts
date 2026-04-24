/**
 * Signal-timeout worker — polls for wait_signal nodes whose timeoutAt has
 * passed without receiving a signal and auto-fails the workflow instance.
 *
 * Configured via:
 *   SIGNAL_TIMEOUT_WORKER_INTERVAL_MS  (default 60000 = 1 minute)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const INTERVAL_MS = parseInt(
  process.env.SIGNAL_TIMEOUT_WORKER_INTERVAL_MS ?? "60000",
  10
);

async function tick() {
  const now = new Date();

  const expired = await db.workflowSignal.findMany({
    where: {
      receivedAt: null,
      timedOutAt: null,
      timeoutAt: { lte: now },
    },
    select: {
      id: true,
      signalKey: true,
      instanceId: true,
      nodeId: true,
      taskId: true,
    },
  });

  if (expired.length === 0) return;

  logger.info("signal-timeout-worker: processing expired signals", {
    count: expired.length,
  });

  for (const signal of expired) {
    try {
      // Mark signal as timed out (idempotent — skip if another worker already did it)
      const updated = await db.workflowSignal.updateMany({
        where: { id: signal.id, receivedAt: null, timedOutAt: null },
        data: { timedOutAt: now },
      });

      if (updated.count === 0) continue; // another worker beat us

      // Skip the placeholder task
      if (signal.taskId) {
        await db.workflowTask.updateMany({
          where: { id: signal.taskId, status: "PENDING" },
          data: { status: "SKIPPED", completedAt: now },
        });
      }

      // Record the timeout event
      await db.workflowEvent.create({
        data: {
          instanceId: signal.instanceId,
          eventType: "SIGNAL_TIMED_OUT",
          actorId: "SYSTEM",
          data: {
            signalKey: signal.signalKey,
            nodeId: signal.nodeId,
          } as object,
        },
      });

      // Mark the workflow instance as CANCELLED (timed out)
      await db.workflowInstance.update({
        where: { id: signal.instanceId },
        data: { status: "CANCELLED", completedAt: now },
      });

      // Skip any remaining PENDING tasks on this instance
      await db.workflowTask.updateMany({
        where: { instanceId: signal.instanceId, status: "PENDING" },
        data: { status: "SKIPPED", completedAt: now },
      });

      logger.info("signal-timeout-worker: instance failed due to signal timeout", {
        instanceId: signal.instanceId,
        signalKey: signal.signalKey,
      });
    } catch (err) {
      logger.error(
        "signal-timeout-worker: failed to process expired signal",
        err,
        { signalKey: signal.signalKey }
      );
    }
  }
}

async function main() {
  logger.info("signal-timeout-worker started", { intervalMs: INTERVAL_MS });

  await tick();
  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("signal-timeout-worker: tick error", err)
    );
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`signal-timeout-worker: ${signal} received, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("signal-timeout-worker: fatal error", err);
  process.exit(1);
});
