import { db } from "@/lib/db";
import { canonicalRowJson, computeRowHash } from "@/lib/audit";

export interface AuditVerifyResult {
  ok: boolean;
  total: number;
  badCount: number;
  unhashedCount: number;
  firstBadId?: string;
}

/**
 * Walk the audit log in chronological order, recomputing each row's hash
 * against its predecessor. Returns the id of the first row whose hash
 * disagrees with the recomputation, plus tallies of bad/unhashed rows.
 *
 * Rows with null `hash` (pre-feature legacy rows) are counted under
 * `unhashedCount` and don't trigger a chain break — run the backfill
 * script (scripts/audit-backfill-hashes.ts) to seed them.
 */
export async function verifyAuditChain(opts?: {
  sinceId?: string;
  until?: Date;
}): Promise<AuditVerifyResult> {
  const where: { occurredAt?: { lte: Date } } = {};
  if (opts?.until) where.occurredAt = { lte: opts.until };

  const PAGE = 1000;
  let cursor: string | undefined = opts?.sinceId;
  let total = 0;
  let badCount = 0;
  let unhashedCount = 0;
  let firstBadId: string | undefined;
  let expectedPrev: string | null = null;

  // If we're starting from a cursor, seed expectedPrev from the previous row.
  if (cursor) {
    const seed = await db.auditLog.findUnique({
      where: { id: cursor },
      select: { hash: true },
    });
    expectedPrev = seed?.hash ?? null;
  }

  for (;;) {
    const page: Array<{
      id: string;
      userId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      metadata: unknown;
      occurredAt: Date;
      prevHash: string | null;
      hash: string | null;
    }> = await db.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;

    for (const row of page) {
      total++;
      if (row.hash === null) {
        unhashedCount++;
        // Treat unhashed rows as opaque pass-throughs; their successor
        // expects a null prevHash chain link until the backfill runs.
        expectedPrev = null;
        continue;
      }
      const recomputed = computeRowHash(row.prevHash, {
        id: row.id,
        userId: row.userId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        metadata: row.metadata,
        occurredAt: row.occurredAt,
      });
      const prevMatches =
        expectedPrev === null || row.prevHash === expectedPrev;
      if (recomputed !== row.hash || !prevMatches) {
        badCount++;
        if (!firstBadId) firstBadId = row.id;
      }
      expectedPrev = row.hash;
    }
    cursor = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }

  // Surface the canonical JSON shape into the result intentionally — kept
  // out of the type to avoid leaking implementation details to callers.
  void canonicalRowJson;

  return {
    ok: badCount === 0,
    total,
    badCount,
    unhashedCount,
    firstBadId,
  };
}
