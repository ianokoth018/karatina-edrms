import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

/**
 * Mark a specific version as the latest for a document,
 * clearing isLatest on all other versions atomically.
 */
export async function markLatest(
  prisma: PrismaClient,
  documentId: string,
  versionId: string
): Promise<void> {
  await prisma.$transaction([
    prisma.documentVersion.updateMany({
      where: { documentId },
      data: { isLatest: false },
    }),
    prisma.documentVersion.update({
      where: { id: versionId },
      data: { isLatest: true },
    }),
  ]);
}

/**
 * Find all documents with expired checkouts and force-check them in.
 * Called by the checkout-expiry-worker on a schedule.
 * Returns the count of documents force-checked in.
 */
export async function expireCheckouts(prisma: PrismaClient): Promise<number> {
  try {
    const expired = await prisma.document.findMany({
      where: {
        checkoutUserId: { not: null },
        checkoutExpiresAt: { lt: new Date() },
      },
      select: { id: true, referenceNumber: true, checkoutUserId: true },
    });

    if (expired.length === 0) return 0;

    await prisma.document.updateMany({
      where: {
        id: { in: expired.map((d) => d.id) },
      },
      data: {
        status: "ACTIVE",
        checkoutUserId: null,
        checkoutAt: null,
        checkoutExpiresAt: null,
        checkoutToken: null,
      },
    });

    logger.info("expireCheckouts: force-checked in expired documents", {
      count: expired.length,
      ids: expired.map((d) => d.id),
    });

    return expired.length;
  } catch (err) {
    logger.error("expireCheckouts: failed", err);
    return 0;
  }
}
