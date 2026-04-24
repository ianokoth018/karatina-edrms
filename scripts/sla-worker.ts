/**
 * SLA worker — periodically runs the SLA escalation check and retries
 * any failed webhook deliveries.
 *
 * Configured via:
 *   SLA_WORKER_INTERVAL_MS   (default 300000 = 5 minutes)
 *   WEBHOOK_RETRY_INTERVAL_MS (default 60000 = 1 minute)
 */

import { checkAndEscalateOverdueTasks } from "@/lib/workflow-sla";
import { attemptWebhook } from "@/lib/workflow-engine";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const SLA_INTERVAL_MS = parseInt(process.env.SLA_WORKER_INTERVAL_MS ?? "300000", 10);
const WEBHOOK_INTERVAL_MS = parseInt(process.env.WEBHOOK_RETRY_INTERVAL_MS ?? "60000", 10);

async function runSlaCheck() {
  try {
    const result = await checkAndEscalateOverdueTasks();
    if (result.escalated > 0 || result.reminded > 0) {
      logger.info("sla-worker: check complete", result);
    }
  } catch (err) {
    logger.error("sla-worker: SLA check failed", err);
  }
}

async function retryWebhooks() {
  try {
    const now = new Date();
    const due = await db.webhookLog.findMany({
      where: {
        status: "PENDING",
        nextRetryAt: { lte: now },
      },
      select: { id: true, url: true, payload: true },
    });

    for (const log of due) {
      await attemptWebhook(
        log.id,
        log.url,
        {},
        log.payload as Record<string, unknown>
      );
    }

    if (due.length > 0) {
      logger.info("sla-worker: retried webhooks", { count: due.length });
    }
  } catch (err) {
    logger.error("sla-worker: webhook retry failed", err);
  }
}

async function main() {
  logger.info("sla-worker started", { slaIntervalMs: SLA_INTERVAL_MS, webhookIntervalMs: WEBHOOK_INTERVAL_MS });

  // Run immediately on startup
  await runSlaCheck();
  await retryWebhooks();

  const slaTimer = setInterval(runSlaCheck, SLA_INTERVAL_MS);
  const webhookTimer = setInterval(retryWebhooks, WEBHOOK_INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`sla-worker: ${signal} received, shutting down`);
    clearInterval(slaTimer);
    clearInterval(webhookTimer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("sla-worker: fatal error", err);
  process.exit(1);
});
