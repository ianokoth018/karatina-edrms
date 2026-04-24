/**
 * Checkout expiry worker — scans for documents whose checkoutExpiresAt has
 * passed and force-releases the lock.  Runs on a configurable interval.
 */

import { expireCheckouts } from "@/lib/version-control";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const INTERVAL_MS = parseInt(process.env.CHECKOUT_EXPIRY_INTERVAL_MS ?? "60000", 10);

async function tick() {
  const count = await expireCheckouts(db as unknown as import("@prisma/client").PrismaClient);
  if (count > 0) {
    logger.info("checkout-expiry-worker: released expired locks", { count });
  }
}

async function main() {
  logger.info("checkout-expiry-worker started", { intervalMs: INTERVAL_MS });

  // Run once immediately, then on interval
  await tick();
  const timer = setInterval(() => {
    tick().catch((err) =>
      logger.error("checkout-expiry-worker: tick error", err)
    );
  }, INTERVAL_MS);

  async function shutdown(signal: string) {
    logger.info(`checkout-expiry-worker: received ${signal}, shutting down`);
    clearInterval(timer);
    await db.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("checkout-expiry-worker: fatal startup error", err);
  process.exit(1);
});
