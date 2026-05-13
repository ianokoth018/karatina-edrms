import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(d: T): T {
  return JSON.parse(
    JSON.stringify(d, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/admin/reports/overview?sinceDays=30
 *
 * Executive snapshot of the EDRMS. Lightweight aggregations only —
 * everything here uses Prisma groupBy / count rather than raw scans so
 * the page loads instantly even at millions of documents.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const sinceDays = Math.max(
      1,
      Math.min(365, Number(new URL(req.url).searchParams.get("sinceDays") ?? "30"))
    );
    const since = new Date(Date.now() - sinceDays * 86_400_000);

    const [
      totalDocs,
      docsInWindow,
      byType,
      byStatus,
      byDept,
      byClassification,
      workflowsInProgress,
      tasksOverdue,
      retentionDueSoon,
      topCreators,
      activeBatches,
      completedBatches,
      scanAggregate,
    ] = await Promise.all([
      db.document.count(),
      db.document.count({ where: { createdAt: { gte: since } } }),
      db.document.groupBy({
        by: ["documentType"],
        _count: true,
        orderBy: { _count: { documentType: "desc" } },
        take: 10,
      }),
      db.document.groupBy({
        by: ["status"],
        _count: true,
      }),
      db.document.groupBy({
        by: ["department"],
        _count: true,
        orderBy: { _count: { department: "desc" } },
        take: 10,
      }),
      db.document.groupBy({
        by: ["securityClassification"],
        _count: true,
      }),
      db.workflowInstance.count({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      }),
      db.workflowTask.count({
        where: {
          status: "PENDING",
          dueAt: { lt: new Date() },
        },
      }),
      // Documents whose retention expires in the next 90 days — auditors
      // and records officers care about this number weekly.
      db.document.count({
        where: {
          retentionExpiresAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 90 * 86_400_000),
          },
        },
      }),
      db.document.groupBy({
        by: ["createdById"],
        _count: true,
        where: { createdAt: { gte: since } },
        orderBy: { _count: { createdById: "desc" } },
        take: 10,
      }),
      // Digitisation QA block — scan-batch tallies for the operational dashboard
      db.scanBatch.count({ where: { status: "IN_PROGRESS" } }),
      db.scanBatch.count({ where: { status: "COMPLETED" } }),
      db.scanBatch.aggregate({
        _sum: { actualPages: true, legibleCount: true },
      }),
    ]);

    // Resolve creator IDs to display names in one query.
    const creatorIds = topCreators.map((t) => t.createdById);
    const creators = creatorIds.length
      ? await db.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, displayName: true, name: true },
        })
      : [];
    const creatorMap = new Map(
      creators.map((c) => [c.id, c.displayName || c.name])
    );

    const totalScannedPages = scanAggregate._sum.actualPages ?? 0;
    const totalLegiblePages = scanAggregate._sum.legibleCount ?? 0;
    const passRate = totalScannedPages > 0 ? totalLegiblePages / totalScannedPages : 0;

    return NextResponse.json(
      serialise({
        sinceDays,
        totals: {
          documents: totalDocs,
          documentsCreatedInWindow: docsInWindow,
          workflowsInProgress,
          tasksOverdue,
          retentionDueSoon,
        },
        digitisation: {
          activeBatches,
          completedBatches,
          totalScannedPages,
          passRate: Number(passRate.toFixed(4)),
        },
        breakdowns: {
          byType: byType.map((b) => ({ key: b.documentType, count: b._count })),
          byStatus: byStatus.map((b) => ({ key: b.status, count: b._count })),
          byDepartment: byDept.map((b) => ({ key: b.department, count: b._count })),
          byClassification: byClassification.map((b) => ({
            key: b.securityClassification,
            count: b._count,
          })),
        },
        topCreators: topCreators.map((t) => ({
          userId: t.createdById,
          name: creatorMap.get(t.createdById) ?? "(unknown)",
          count: t._count,
        })),
      })
    );
  } catch (error) {
    logger.error("Reports overview failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
