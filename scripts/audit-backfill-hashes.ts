// Backfill the prevHash/hash columns onto pre-feature AuditLog rows.
// Idempotent: only rows with null hash are updated, and rows are processed
// in (occurredAt, id) order so the chain matches what writeAudit would
// have produced if the feature had always been on.
//
// Run with: npx tsx scripts/audit-backfill-hashes.ts

import { db } from "@/lib/db";
import { computeRowHash } from "@/lib/audit";

const PAGE = 1000;

async function main() {
  console.log("Backfilling audit log hash chain…");
  let cursor: string | undefined;
  let prevHash: string | null = null;
  let processed = 0;
  let updated = 0;
  let alreadyHashed = 0;

  // Seed prevHash from the last hashed row in the entire log so backfill
  // can be resumed safely on a partially-hashed table.
  const lastHashed = await db.auditLog.findFirst({
    where: { hash: { not: null } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { hash: true },
  });
  if (lastHashed) {
    console.log(`Found ${lastHashed.hash?.slice(0, 16)}… as last hashed row.`);
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
      hash: string | null;
    }> = await db.auditLog.findMany({
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        userId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        occurredAt: true,
        hash: true,
      },
    });
    if (page.length === 0) break;

    for (const row of page) {
      processed++;
      if (row.hash !== null) {
        alreadyHashed++;
        prevHash = row.hash;
        continue;
      }
      const hash = computeRowHash(prevHash, {
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
      await db.auditLog.update({
        where: { id: row.id },
        data: { prevHash, hash },
      });
      prevHash = hash;
      updated++;
    }

    if (processed % 1000 < page.length) {
      console.log(`  processed=${processed} updated=${updated}`);
    }
    cursor = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }

  console.log(
    `Done. processed=${processed} updated=${updated} alreadyHashed=${alreadyHashed}`
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
