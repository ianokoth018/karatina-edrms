import crypto from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Write a tamper-evident audit log entry.
 * Every row carries `hash = sha256(prevHash + '|' + canonicalJson(row))`.
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
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74100201)`;
      const last = await tx.auditLog.findFirst({
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { hash: true },
      });
      const prevHash = last?.hash ?? null;
      const id = cuidLike();
      const occurredAt = new Date();
      const metadata = (params.metadata as Record<string, never>) ?? {};
      const row = {
        id,
        userId: params.userId ?? null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata,
        occurredAt,
      };
      const hash = computeRowHash(prevHash, row);
      await tx.auditLog.create({ data: { ...row, prevHash, hash } });
    });
  } catch (error) {
    logger.error("Failed to write audit log", error, {
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      userId: params.userId,
    });
  }
}

export function canonicalRowJson(row: {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  occurredAt: Date;
}): string {
  return stableStringify({
    id: row.id,
    userId: row.userId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata ?? {},
    occurredAt: row.occurredAt.toISOString(),
  });
}

export function computeRowHash(
  prevHash: string | null,
  row: Parameters<typeof canonicalRowJson>[0]
): string {
  const canonical = canonicalRowJson(row);
  return crypto
    .createHash("sha256")
    .update((prevHash ?? "") + "|" + canonical)
    .digest("hex");
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

function cuidLike(): string {
  return "c" + Date.now().toString(36) + crypto.randomBytes(8).toString("hex");
}
