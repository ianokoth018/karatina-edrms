/**
 * Timer worker — polls for PENDING timer tasks whose activation time (dueAt)
 * has passed and advances the workflow graph through those timer nodes.
 *
 * Timer tasks are identified by stepIndex === -1 (set by the engine when it
 * creates them). When dueAt passes the task is auto-approved and graph
 * traversal continues.
 */

import { advanceWorkflow } from "@/lib/workflow-engine";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const INTERVAL_MS = parseInt(process.env.TIMER_WORKER_INTERVAL_MS ?? "60000", 10);

async function tick() {
  const now = new Date();

  const timerTasks = await db.workflowTask.findMany({
    where: {
      status: "PENDING",
      stepIndex: -1,       // timer/subprocess placeholder marker
      dueAt: { lte: now },
    },
    select: { id: true, instanceId: true, stepName: true },
  });

  if (timerTasks.length === 0) return;

  logger.info("timer-worker: activating expired timer tasks", { count: timerTasks.length });

  for (const task of timerTasks) {
    try {
      // Mark the timer task completed first so the engine can advance
      await db.workflowTask.update({
        where: { id: task.id },
        data: { status: "COMPLETED", action: "APPROVED", completedAt: new Date() },
      });

      await advanceWorkflow({
        instanceId: task.instanceId,
        completedTaskId: task.id,
        action: "APPROVED",
        actorId: "SYSTEM",
        comment: "Timer activated automatically",
      });

      logger.info("timer-worker: timer task activated", { taskId: task.id, step: task.stepName });
    } catch (err) {
      logger.error("timer-worker: failed to activate timer task", err, { taskId: task.id });
    }
  }
}

async function main() {
  logger.info("timer-worker started", { intervalMs: INTERVAL_MS });

  await tick();
  const timer = setInterval(() => {
    tick().catch((err) => logger.error("timer-worker: tick error", err));
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`timer-worker: ${signal} received, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("timer-worker: fatal error", err);
  process.exit(1);
});
