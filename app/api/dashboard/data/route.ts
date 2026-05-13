import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import type { DashboardData } from "@/lib/widgets";

function serialise<T>(d: T): T {
  return JSON.parse(
    JSON.stringify(d, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/dashboard/data?sinceDays=30
 *
 * Same shape as /api/admin/reports/overview but scoped to *this user's*
 * accessible documents (via buildDocumentAccessWhere). No admin gate —
 * any signed-in user can hit it; their own filter takes care of leakage.
 *
 * Response is cached for 60s per user via Cache-Control.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sinceDays = Math.max(
      1,
      Math.min(
        365,
        Number(new URL(req.url).searchParams.get("sinceDays") ?? "30")
      )
    );
    const windowEnd = new Date();
    const windowStart = new Date(Date.now() - sinceDays * 86_400_000);
    const prevWindowStart = new Date(
      windowStart.getTime() - sinceDays * 86_400_000
    );

    const accessWhere = await buildDocumentAccessWhere(session);
    const accessAnd = (extra: Record<string, unknown>) =>
      Object.keys(accessWhere).length
        ? { AND: [accessWhere, extra] }
        : extra;

    const userId = session.user.id;

    const [
      totalDocs,
      docsInWindow,
      docsPrevWindow,
      workflowsInProgress,
      tasksPending,
      tasksOverdue,
      myMemos,
      pendingMemos,
      byType,
      byStatus,
      byDept,
      byClassification,
      topCreators,
      recentDocs,
    ] = await Promise.all([
      db.document.count({ where: accessWhere }).catch(() => 0),
      db.document
        .count({ where: accessAnd({ createdAt: { gte: windowStart } }) })
        .catch(() => 0),
      db.document
        .count({
          where: accessAnd({
            createdAt: { gte: prevWindowStart, lt: windowStart },
          }),
        })
        .catch(() => 0),
      db.workflowInstance
        .count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } })
        .catch(() => 0),
      db.workflowTask
        .count({ where: { assigneeId: userId, status: "PENDING" } })
        .catch(() => 0),
      db.workflowTask
        .count({
          where: {
            assigneeId: userId,
            status: "PENDING",
            dueAt: { lt: new Date() },
          },
        })
        .catch(() => 0),
      db.workflowInstance
        .count({
          where: {
            document: { documentType: { in: ["MEMO", "Internal Memo"] } },
            OR: [
              { initiatedById: userId },
              { tasks: { some: { assigneeId: userId } } },
            ],
          },
        })
        .catch(() => 0),
      db.workflowInstance
        .count({
          where: {
            document: { documentType: { in: ["MEMO", "Internal Memo"] } },
            status: { in: ["PENDING", "IN_PROGRESS"] },
            tasks: { some: { assigneeId: userId, status: "PENDING" } },
          },
        })
        .catch(() => 0),
      db.document
        .groupBy({
          by: ["documentType"],
          _count: true,
          where: accessWhere,
          orderBy: { _count: { documentType: "desc" } },
          take: 10,
        })
        .catch(() => [] as { documentType: string; _count: number }[]),
      db.document
        .groupBy({
          by: ["status"],
          _count: true,
          where: accessWhere,
        })
        .catch(() => [] as { status: string; _count: number }[]),
      db.document
        .groupBy({
          by: ["department"],
          _count: true,
          where: accessWhere,
          orderBy: { _count: { department: "desc" } },
          take: 10,
        })
        .catch(() => [] as { department: string; _count: number }[]),
      db.document
        .groupBy({
          by: ["securityClassification"],
          _count: true,
          where: accessWhere,
        })
        .catch(
          () =>
            [] as { securityClassification: string; _count: number }[]
        ),
      db.document
        .groupBy({
          by: ["createdById"],
          _count: true,
          where: accessAnd({ createdAt: { gte: windowStart } }),
          orderBy: { _count: { createdById: "desc" } },
          take: 10,
        })
        .catch(() => [] as { createdById: string; _count: number }[]),
      db.document
        .findMany({
          where: accessWhere,
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            title: true,
            documentType: true,
            createdAt: true,
          },
        })
        .catch(
          () =>
            [] as {
              id: string;
              title: string;
              documentType: string;
              createdAt: Date;
            }[]
        ),
    ]);

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

    const payload: DashboardData = {
      sinceDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      totals: {
        documents: totalDocs,
        documentsCreatedInWindow: docsInWindow,
        documentsCreatedPrevWindow: docsPrevWindow,
        workflowsInProgress,
        tasksPending,
        tasksOverdue,
        myMemos,
        pendingMemos,
      },
      breakdowns: {
        byType: byType.map((b) => ({
          key: b.documentType,
          count: b._count,
        })),
        byStatus: byStatus.map((b) => ({ key: b.status, count: b._count })),
        byDepartment: byDept.map((b) => ({
          key: b.department,
          count: b._count,
        })),
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
      recentDocuments: recentDocs.map((d) => ({
        id: d.id,
        title: d.title,
        documentType: d.documentType,
        createdAt: d.createdAt.toISOString(),
      })),
    };

    return NextResponse.json(serialise(payload), {
      headers: {
        // Per-user cache for 60s. `private` keeps the CDN out.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    logger.error("Dashboard data fetch failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
