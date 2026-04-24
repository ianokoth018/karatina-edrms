import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getDirectorateForDepartment,
  getDepartmentsInDirectorate,
} from "@/lib/departments";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Role helpers -- scope tiers
//   institutional → ADMIN / VICE_CHANCELLOR see the whole institution
//   directorate   → DVC / Registrar / Director / Dean see their directorate
//   departmental  → HOD / department officers see their department
//   individual    → everyone else sees only their own memos (and memos where
//                   they have an assigned task)
// ---------------------------------------------------------------------------
const INSTITUTIONAL_ROLES = new Set(["ADMIN", "VICE_CHANCELLOR"]);
const DIRECTORATE_ROLES = new Set([
  "DVC_PFA",
  "DVC_ARSA",
  "DEAN",
  "DIRECTOR",
  "REGISTRAR_PA",
  "REGISTRAR_ARSA",
]);
const DEPARTMENTAL_ROLES = new Set([
  "HOD",
  "FINANCE_OFFICER",
  "HR_OFFICER",
  "PROCUREMENT_OFFICER",
  "ICT_OFFICER",
  "INTERNAL_AUDITOR",
  "LEGAL_OFFICER",
  "LIBRARIAN",
  "MEDICAL_OFFICER",
  "ESTATES_OFFICER",
  "SECURITY_OFFICER",
  "RECORDS_MANAGER",
  "RECORDS_OFFICER",
]);

type Scope = "institutional" | "directorate" | "departmental" | "individual";

function resolveScope(roles: string[]): Scope {
  if (roles.some((r) => INSTITUTIONAL_ROLES.has(r))) return "institutional";
  if (roles.some((r) => DIRECTORATE_ROLES.has(r))) return "directorate";
  if (roles.some((r) => DEPARTMENTAL_ROLES.has(r))) return "departmental";
  return "individual";
}

function computeMemoStatus(
  workflowStatus: string,
  currentStepIndex: number,
  tasks: { stepName: string; stepIndex: number; status: string }[],
  events: { data: Prisma.JsonValue }[],
  memoType: string,
): string {
  if (memoType === "communicating" && workflowStatus === "COMPLETED") {
    return "SENT";
  }
  if (workflowStatus === "COMPLETED") return "APPROVED";
  if (workflowStatus === "REJECTED") return "REJECTED";
  if (workflowStatus === "CANCELLED") return "CANCELLED";

  const hasReturnEvent = events.some(
    (e) => (e.data as Record<string, unknown>)?.action === "RETURNED",
  );
  if (hasReturnEvent && currentStepIndex === 0) return "RETURNED";

  const currentTask = tasks.find((t) => t.status === "PENDING");
  if (currentTask?.stepName === "Final Approval") return "PENDING_APPROVAL";
  if (currentTask?.stepName?.startsWith("Recommendation"))
    return "PENDING_RECOMMENDATION";
  return "DRAFT";
}

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRoles = (session.user.roles as string[] | undefined) ?? [];
    const userDepartment = session.user.department || null;

    let scope = resolveScope(userRoles);

    // -----------------------------------------------------------------------
    // Build scope-appropriate Prisma filter. Always constrain to MEMO docs.
    // -----------------------------------------------------------------------
    let baseWhere: Prisma.WorkflowInstanceWhereInput;
    let scopeLabel: string;
    let scopeDepartment: string | null = null;
    let scopeDirectorate: string | null = null;

    if (scope === "directorate") {
      const directorate = getDirectorateForDepartment(userDepartment);
      if (!directorate) {
        // Fall back to departmental scope when the user's department is
        // unmapped to any directorate.
        scope = "departmental";
      } else {
        scopeDirectorate = directorate;
      }
    }

    // Match both legacy "MEMO" and the current "Internal Memo" casefolder type
    // (memos filed via the Internal Memo casefolder are stored with that type).
    const memoDocTypes = { in: ["MEMO", "Internal Memo"] };

    if (scope === "institutional") {
      baseWhere = { document: { documentType: memoDocTypes } };
      scopeLabel = "Institutional View";
    } else if (scope === "directorate") {
      const deptsInDirectorate = getDepartmentsInDirectorate(scopeDirectorate);
      baseWhere = {
        document: {
          documentType: memoDocTypes,
          department: { in: deptsInDirectorate },
        },
      };
      scopeLabel = `Directorate View — ${scopeDirectorate}`;
    } else if (scope === "departmental") {
      scopeDepartment = userDepartment;
      baseWhere = {
        document: {
          documentType: memoDocTypes,
          department: userDepartment ?? undefined,
        },
      };
      scopeLabel = `Departmental View — ${userDepartment ?? "Unassigned"}`;
    } else {
      baseWhere = {
        document: { documentType: memoDocTypes },
        OR: [
          { initiatedById: userId },
          { tasks: { some: { assigneeId: userId } } },
        ],
      };
      scopeLabel = "Individual View";
    }

    // -----------------------------------------------------------------------
    // Fetch the raw workflow instances once (with just enough data to compute
    // statuses + KPIs + status breakdown). We keep this lean so it scales.
    // -----------------------------------------------------------------------
    const instances = await db.workflowInstance.findMany({
      where: baseWhere,
      select: {
        id: true,
        referenceNumber: true,
        subject: true,
        status: true,
        currentStepIndex: true,
        startedAt: true,
        completedAt: true,
        initiatedById: true,
        formData: true,
        tasks: {
          select: {
            id: true,
            stepName: true,
            stepIndex: true,
            status: true,
            assigneeId: true,
            completedAt: true,
            assignee: {
              select: { id: true, name: true, displayName: true },
            },
          },
          orderBy: { stepIndex: "asc" },
        },
        events: {
          select: { data: true },
          orderBy: { occurredAt: "desc" },
        },
        document: {
          select: { department: true },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    const totalMemos = instances.length;

    // -----------------------------------------------------------------------
    // Per-memo status computation
    // -----------------------------------------------------------------------
    const enriched = instances.map((m) => {
      const formData = (m.formData as Record<string, unknown>) ?? {};
      const memoType =
        formData.memoType === "communicating" ? "communicating" : "administrative";
      const status = computeMemoStatus(
        m.status,
        m.currentStepIndex,
        m.tasks,
        m.events,
        memoType,
      );
      const pending = m.tasks.filter((t) => t.status === "PENDING");
      const lowestPendingIdx =
        pending.length > 0 ? Math.min(...pending.map((t) => t.stepIndex)) : null;
      const currentAssignee =
        lowestPendingIdx !== null
          ? pending.find((t) => t.stepIndex === lowestPendingIdx)?.assignee ?? null
          : null;
      return { ...m, memoStatus: status, currentAssignee };
    });

    // -----------------------------------------------------------------------
    // KPIs
    // -----------------------------------------------------------------------
    const pending = enriched.filter((m) => m.status === "IN_PROGRESS").length;
    const approved = enriched.filter(
      (m) => m.status === "COMPLETED" && m.memoStatus !== "REJECTED",
    ).length;
    const rejected = enriched.filter((m) => m.status === "REJECTED").length;
    const returned = enriched.filter((m) => m.memoStatus === "RETURNED").length;

    // Avg turnaround (hours) over COMPLETED memos
    const completed = enriched.filter(
      (m) => m.status === "COMPLETED" && m.startedAt && m.completedAt,
    );
    const avgTurnaroundHours =
      completed.length > 0
        ? completed.reduce((acc, m) => {
            const diffMs =
              new Date(m.completedAt!).getTime() - new Date(m.startedAt).getTime();
            return acc + diffMs / (1000 * 60 * 60);
          }, 0) / completed.length
        : null;

    const approvalDenom = approved + rejected;
    const approvalRate = approvalDenom > 0 ? approved / approvalDenom : null;

    // -----------------------------------------------------------------------
    // Status breakdown
    // -----------------------------------------------------------------------
    const statusCounts = new Map<string, number>();
    for (const m of enriched) {
      statusCounts.set(m.memoStatus, (statusCounts.get(m.memoStatus) ?? 0) + 1);
    }
    const statusBreakdown = Array.from(statusCounts.entries()).map(
      ([status, count]) => ({ status, count }),
    );

    // -----------------------------------------------------------------------
    // Memos over time (last 30 days, daily buckets)
    // -----------------------------------------------------------------------
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const dateBuckets = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      dateBuckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const m of enriched) {
      const startDate = new Date(m.startedAt);
      if (startDate >= thirtyDaysAgo) {
        const key = startDate.toISOString().slice(0, 10);
        if (dateBuckets.has(key)) {
          dateBuckets.set(key, (dateBuckets.get(key) ?? 0) + 1);
        }
      }
    }
    const memosOverTime = Array.from(dateBuckets.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // -----------------------------------------------------------------------
    // Scope-conditional aggregates
    // -----------------------------------------------------------------------
    let byDepartment: { department: string; count: number }[] | undefined;
    // Top initiators groups by *directorate* on institutional view, by
    // *department* on directorate view, and by *individual user* on
    // departmental view. The page uses `topInitiatorsGroupBy` to label the
    // section appropriately.
    let topInitiators:
      | { key: string; name: string; count: number }[]
      | undefined;
    let topInitiatorsGroupBy: "directorate" | "department" | "user" | undefined;
    let topRecommenders:
      | { userId: string; name: string; completed: number; avgHours: number | null }[]
      | undefined;

    if (
      scope === "institutional" ||
      scope === "directorate"
    ) {
      const deptCounts = new Map<string, number>();
      for (const m of enriched) {
        const dept = m.document?.department ?? "Unassigned";
        deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
      }
      byDepartment = Array.from(deptCounts.entries())
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count);
    }

    if (
      scope === "institutional" ||
      scope === "directorate" ||
      scope === "departmental"
    ) {
      // ---- Top initiators (grouped by scope) ----
      // Pre-resolve creator names so we can fall back to the memo's author
      // when its directorate/department can't be determined (avoids a chart
      // dominated by an "Unassigned" bar).
      const allInitiatorIds = Array.from(
        new Set(enriched.map((m) => m.initiatedById)),
      );
      const allInitiators =
        allInitiatorIds.length > 0
          ? await db.user.findMany({
              where: { id: { in: allInitiatorIds } },
              select: { id: true, displayName: true, name: true },
            })
          : [];
      const creatorNameById = new Map(
        allInitiators.map((u) => [u.id, u.displayName || u.name]),
      );

      if (scope === "institutional") {
        // Group by directorate; fall back to creator name when unmapped
        topInitiatorsGroupBy = "directorate";
        const dirCounts = new Map<string, number>();
        for (const m of enriched) {
          const dept = m.document?.department ?? null;
          const directorate = getDirectorateForDepartment(dept);
          const bucket =
            directorate ??
            creatorNameById.get(m.initiatedById) ??
            "Unknown";
          dirCounts.set(bucket, (dirCounts.get(bucket) ?? 0) + 1);
        }
        topInitiators = Array.from(dirCounts.entries())
          .map(([directorate, count]) => ({
            key: directorate,
            name: directorate,
            count,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      } else if (scope === "directorate") {
        // Group by department; fall back to creator name when unset
        topInitiatorsGroupBy = "department";
        const deptCounts = new Map<string, number>();
        for (const m of enriched) {
          const dept = m.document?.department;
          const bucket =
            (dept && dept.trim()) ||
            creatorNameById.get(m.initiatedById) ||
            "Unknown";
          deptCounts.set(bucket, (deptCounts.get(bucket) ?? 0) + 1);
        }
        topInitiators = Array.from(deptCounts.entries())
          .map(([department, count]) => ({
            key: department,
            name: department,
            count,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      } else {
        // departmental: group by individual user
        topInitiatorsGroupBy = "user";
        const initiatorCounts = new Map<string, number>();
        for (const m of enriched) {
          initiatorCounts.set(
            m.initiatedById,
            (initiatorCounts.get(m.initiatedById) ?? 0) + 1,
          );
        }
        const topInitiatorIds = Array.from(initiatorCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        topInitiators = topInitiatorIds.map(([userId, count]) => ({
          key: userId,
          name: creatorNameById.get(userId) ?? "Unknown",
          count,
        }));
      }

      // Top recommenders — completed WorkflowTasks in scope
      const scopeInstanceIds = enriched.map((m) => m.id);
      if (scopeInstanceIds.length > 0) {
        const completedTasks = await db.workflowTask.findMany({
          where: {
            instanceId: { in: scopeInstanceIds },
            status: "COMPLETED",
            stepName: { not: "Self-Review" },
          },
          select: {
            assigneeId: true,
            completedAt: true,
            assignedAt: true,
            assignee: { select: { id: true, displayName: true, name: true } },
          },
        });
        const stats = new Map<
          string,
          { name: string; completed: number; totalHours: number; hoursCount: number }
        >();
        for (const t of completedTasks) {
          if (!t.assigneeId) continue;
          const existing = stats.get(t.assigneeId) ?? {
            name: t.assignee?.displayName || t.assignee?.name || "Unknown",
            completed: 0,
            totalHours: 0,
            hoursCount: 0,
          };
          existing.completed += 1;
          if (t.completedAt && t.assignedAt) {
            const hrs =
              (new Date(t.completedAt).getTime() -
                new Date(t.assignedAt).getTime()) /
              (1000 * 60 * 60);
            if (hrs >= 0) {
              existing.totalHours += hrs;
              existing.hoursCount += 1;
            }
          }
          stats.set(t.assigneeId, existing);
        }
        topRecommenders = Array.from(stats.entries())
          .map(([userId, v]) => ({
            userId,
            name: v.name,
            completed: v.completed,
            avgHours: v.hoursCount > 0 ? v.totalHours / v.hoursCount : null,
          }))
          .sort((a, b) => b.completed - a.completed)
          .slice(0, 5);
      } else {
        topRecommenders = [];
      }
    }

    // -----------------------------------------------------------------------
    // Recent activity (10 most recent)
    // -----------------------------------------------------------------------
    const recentActivity = enriched.slice(0, 10).map((m) => ({
      id: m.id,
      referenceNumber: m.referenceNumber,
      subject: m.subject,
      status: m.memoStatus,
      startedAt: m.startedAt.toISOString(),
      currentAssignee: m.currentAssignee
        ? {
            id: m.currentAssignee.id,
            name: m.currentAssignee.displayName || m.currentAssignee.name,
          }
        : null,
    }));

    return NextResponse.json({
      scope,
      scopeLabel,
      department: scope === "departmental" ? scopeDepartment : undefined,
      directorate: scope === "directorate" ? scopeDirectorate : undefined,
      kpis: {
        totalMemos,
        pending,
        approved,
        rejected,
        returned,
        avgTurnaroundHours,
        approvalRate,
      },
      statusBreakdown,
      memosOverTime,
      byDepartment,
      topInitiators,
      topInitiatorsGroupBy,
      topRecommenders,
      recentActivity,
    });
  } catch (error) {
    logger.error("Failed to compute memo analytics", error, {
      route: "/api/memos/analytics",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
