import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const VALID_TYPES = [
  "documents",
  "workflows",
  "users",
  "audit",
  "physical",
  "retention",
] as const;

type ReportType = (typeof VALID_TYPES)[number];

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type") as ReportType | null;

  if (!type || !VALID_TYPES.includes(type)) {
    return Response.json(
      {
        error: `Invalid report type. Must be one of: ${VALID_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const data = await getReportData(type);
    return Response.json(data);
  } catch (error) {
    console.error(`[Reports API] Error fetching ${type} report:`, error);
    return Response.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}

async function getReportData(type: ReportType) {
  switch (type) {
    case "documents":
      return getDocumentsReport();
    case "workflows":
      return getWorkflowsReport();
    case "users":
      return getUsersReport();
    case "audit":
      return getAuditReport();
    case "physical":
      return getPhysicalReport();
    case "retention":
      return getRetentionReport();
  }
}

// ---------------------------------------------------------------------------
// Documents Report
// ---------------------------------------------------------------------------
async function getDocumentsReport() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [byStatus, byDepartmentRaw, byTypeRaw, recentTrendRaw] =
    await Promise.all([
      db.document.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      db.document.groupBy({
        by: ["department"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      db.document.groupBy({
        by: ["documentType"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      db.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT to_char("createdAt", 'YYYY-MM') AS month, COUNT(*)::bigint AS count
        FROM documents
        WHERE "createdAt" >= ${sixMonthsAgo}
        GROUP BY month
        ORDER BY month ASC
      `,
    ]);

  return {
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    byDepartment: byDepartmentRaw.map((r) => ({
      department: r.department,
      count: r._count.id,
    })),
    byType: byTypeRaw.map((r) => ({
      type: r.documentType,
      count: r._count.id,
    })),
    recentTrend: recentTrendRaw.map((r) => ({
      month: r.month,
      count: Number(r.count),
    })),
  };
}

// ---------------------------------------------------------------------------
// Workflows Report
// ---------------------------------------------------------------------------
async function getWorkflowsReport() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [byStatus, avgCompletionRaw, completedByMonthRaw] = await Promise.all([
    db.workflowInstance.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.$queryRaw<{ avg_days: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) / 86400)::float AS avg_days
      FROM workflow_instances
      WHERE status = 'COMPLETED' AND "completedAt" IS NOT NULL
    `,
    db.$queryRaw<{ month: string; count: bigint }[]>`
      SELECT to_char("completedAt", 'YYYY-MM') AS month, COUNT(*)::bigint AS count
      FROM workflow_instances
      WHERE status = 'COMPLETED'
        AND "completedAt" IS NOT NULL
        AND "completedAt" >= ${sixMonthsAgo}
      GROUP BY month
      ORDER BY month ASC
    `,
  ]);

  return {
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    avgCompletionDays:
      avgCompletionRaw[0]?.avg_days != null
        ? Math.round(avgCompletionRaw[0].avg_days * 10) / 10
        : null,
    completedByMonth: completedByMonthRaw.map((r) => ({
      month: r.month,
      count: Number(r.count),
    })),
  };
}

// ---------------------------------------------------------------------------
// Users Report
// ---------------------------------------------------------------------------
async function getUsersReport() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalUsers, activeUsers, byDepartmentRaw, loginsLast7, loginsLast30] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { isActive: true } }),
      db.user.groupBy({
        by: ["department"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      db.user.count({
        where: { lastLoginAt: { gte: sevenDaysAgo } },
      }),
      db.user.count({
        where: { lastLoginAt: { gte: thirtyDaysAgo } },
      }),
    ]);

  return {
    totalUsers,
    activeUsers,
    byDepartment: byDepartmentRaw.map((r) => ({
      department: r.department ?? "Unassigned",
      count: r._count.id,
    })),
    recentLogins: {
      last7Days: loginsLast7,
      last30Days: loginsLast30,
    },
  };
}

// ---------------------------------------------------------------------------
// Audit Report
// ---------------------------------------------------------------------------
async function getAuditReport() {
  const [totalEntries, byActionRaw, byResourceTypeRaw, recentActivity] =
    await Promise.all([
      db.auditLog.count(),
      db.auditLog.groupBy({
        by: ["action"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      db.auditLog.groupBy({
        by: ["resourceType"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      db.auditLog.findMany({
        take: 50,
        orderBy: { occurredAt: "desc" },
        include: {
          user: {
            select: { displayName: true },
          },
        },
      }),
    ]);

  return {
    totalEntries,
    byAction: byActionRaw.map((r) => ({
      action: r.action,
      count: r._count.id,
    })),
    byResourceType: byResourceTypeRaw.map((r) => ({
      resourceType: r.resourceType,
      count: r._count.id,
    })),
    recentActivity: recentActivity.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      userName: r.user?.displayName ?? "System",
      occurredAt: r.occurredAt,
      metadata: r.metadata,
    })),
  };
}

// ---------------------------------------------------------------------------
// Physical Records Report
// ---------------------------------------------------------------------------
async function getPhysicalReport() {
  const [byStatus, byLocationRaw, checkedOutCount] = await Promise.all([
    db.physicalRecord.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    db.$queryRaw<{ location: string; count: bigint }[]>`
      SELECT COALESCE("shelfLocation", "offSiteLocation", 'Unknown') AS location,
             COUNT(*)::bigint AS count
      FROM physical_records
      GROUP BY location
      ORDER BY count DESC
      LIMIT 10
    `,
    db.physicalRecord.count({
      where: { status: "CHECKED_OUT" },
    }),
  ]);

  return {
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    byLocation: byLocationRaw.map((r) => ({
      location: r.location,
      count: Number(r.count),
    })),
    checkedOutCount,
  };
}

// ---------------------------------------------------------------------------
// Retention Report
// ---------------------------------------------------------------------------
async function getRetentionReport() {
  const now = new Date();

  const [dueForDisposal, byDisposalActionRaw] = await Promise.all([
    db.document.count({
      where: {
        retentionExpiresAt: { lte: now },
        status: { notIn: ["DISPOSED", "PENDING_DISPOSAL"] },
      },
    }),
    db.retentionSchedule.groupBy({
      by: ["disposalAction"],
      _count: { id: true },
    }),
  ]);

  return {
    dueForDisposal,
    byDisposalAction: byDisposalActionRaw.map((r) => ({
      action: r.disposalAction,
      count: r._count.id,
    })),
  };
}
