import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Write an immutable audit log entry.
 *
 * This should be called from every mutation endpoint (create, update, delete,
 * approve, etc.) so that every action in the EDRMS is fully traceable.
 */
export async function writeAudit(params: {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: (params.metadata as Record<string, never>) ?? {},
      },
    });
  } catch (error) {
    // Audit failures must never crash the calling request, but we log them
    // at error level so they can be surfaced in monitoring.
    logger.error("Failed to write audit log", error, {
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      userId: params.userId,
    });
  }
}
