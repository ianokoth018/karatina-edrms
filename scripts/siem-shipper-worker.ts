/**
 * SIEM shipper worker.
 *
 * Sweeps `SiemShipLog` rows in status PENDING every 30s and retries
 * delivery to the configured SIEM target.  Rows that have hit
 * `SIEM_MAX_ATTEMPTS` are marked FAILED inside `shipAuditEvent` itself
 * and skipped by subsequent sweeps (an admin can manually re-queue
 * them via the admin UI).
 */

import { retryFailedShipments, siemEnabled } from "@/lib/siem";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const INTERVAL_MS = parseInt(process.env.SIEM_WORKER_INTERVAL_MS ?? "30000", 10);
const BATCH = parseInt(process.env.SIEM_WORKER_BATCH ?? "50", 10);

async function tick() {
  if (!siemEnabled()) return;
  const { delivered, failed } = await retryFailedShipments(BATCH);
  if (delivered > 0 || failed > 0) {
    logger.info("siem-shipper-worker: tick", { delivered, failed });
  }
}

async function main() {
  if (!siemEnabled()) {
    logger.info(
      "siem-shipper-worker: SIEM_TARGET not configured, worker idle (sleeping)"
    );
  } else {
    logger.info("siem-shipper-worker started", {
      intervalMs: INTERVAL_MS,
      batch: BATCH,
    });
  }

  await tick().catch((err) =>
    logger.error("siem-shipper-worker: initial tick error", err)
  );

  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("siem-shipper-worker: tick error", err)
    );
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`siem-shipper-worker: received ${signal}, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("siem-shipper-worker: fatal startup error", err);
  process.exit(1);
});
