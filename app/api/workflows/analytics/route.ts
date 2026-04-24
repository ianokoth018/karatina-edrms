import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/workflows/analytics
 *
 * Query params:
 *   templateId  — filter to a specific template
 *   from        — ISO date start (default: 30 days ago)
 *   to          — ISO date end   (default: now)
 *
 * Returns:
 *   - summary:       total, completed, rejected, cancelled, inProgress, avgCycleDays
 *   - byTemplate:    per-template completion + avg cycle time
 *   - byStep:        per step-name avg completion time (hours)
 *   - slaBreachRate: per-assignee breach %
 *   - peakLoad:      task creation count by day-of-week and hour-of-day
 *   - funnelCompletion: % of instances reaching each step
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get("templateId") ?? undefined;
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toParam ? new Date(toParam) : new Date();

    const instanceWhere: Record<string, unknown> = {
      startedAt: { gte: from, lte: to },
    };
    if (templateId) instanceWhere.templateId = templateId;

    // ----------------------------------------------------------------
    // 1. Summary stats
    // ----------------------------------------------------------------
    const [total, completed, rejected, cancelled, inProgress] = await Promise.all([
      db.workflowInstance.count({ where: instanceWhere }),
      db.workflowInstance.count({ where: { ...instanceWhere, status: "COMPLETED" } }),
      db.workflowInstance.count({ where: { ...instanceWhere, status: "REJECTED" } }),
      db.workflowInstance.count({ where: { ...instanceWhere, status: "CANCELLED" } }),
      db.workflowInstance.count({ where: { ...instanceWhere, status: "IN_PROGRESS" } }),
    ]);

    const completedInstances = await db.workflowInstance.findMany({
      where: { ...instanceWhere, status: "COMPLETED", completedAt: { not: null } },
      select: { startedAt: true, completedAt: true },
    });

    const avgCycleDays =
      completedInstances.length > 0
        ? completedInstances.reduce((sum, i) => {
            const ms = i.completedAt!.getTime() - i.startedAt.getTime();
            return sum + ms / (1000 * 60 * 60 * 24);
          }, 0) / completedInstances.length
        : 0;

    // ----------------------------------------------------------------
    // 2. Per-template breakdown
    // ----------------------------------------------------------------
    const templates = await db.workflowTemplate.findMany({
      where: templateId ? { id: templateId } : {},
      select: { id: true, name: true },
    });

    const byTemplate = await Promise.all(
      templates.map(async (t) => {
        const tWhere = { ...instanceWhere, templateId: t.id };
        const [tTotal, tCompleted, tRejected] = await Promise.all([
          db.workflowInstance.count({ where: tWhere }),
          db.workflowInstance.count({ where: { ...tWhere, status: "COMPLETED" } }),
          db.workflowInstance.count({ where: { ...tWhere, status: "REJECTED" } }),
        ]);

        const tCompletedInst = await db.workflowInstance.findMany({
          where: { ...tWhere, status: "COMPLETED", completedAt: { not: null } },
          select: { startedAt: true, completedAt: true },
        });

        const tAvgCycleDays =
          tCompletedInst.length > 0
            ? tCompletedInst.reduce((s, i) => {
                return s + (i.completedAt!.getTime() - i.startedAt.getTime()) / (1000 * 60 * 60 * 24);
              }, 0) / tCompletedInst.length
            : 0;

        return {
          templateId: t.id,
          templateName: t.name,
          total: tTotal,
          completed: tCompleted,
          rejected: tRejected,
          completionRate: tTotal > 0 ? Math.round((tCompleted / tTotal) * 100) : 0,
          avgCycleDays: Math.round(tAvgCycleDays * 10) / 10,
        };
      })
    );

    // ----------------------------------------------------------------
    // 3. Per-step avg completion time
    // ----------------------------------------------------------------
    const completedTasks = await db.workflowTask.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { not: null },
        instance: { startedAt: { gte: from, lte: to }, ...(templateId ? { templateId } : {}) },
      },
      select: { stepName: true, assignedAt: true, completedAt: true, dueAt: true },
    });

    const stepMap = new Map<string, { totalMs: number; count: number; breached: number }>();
    for (const t of completedTasks) {
      const ms = t.completedAt!.getTime() - t.assignedAt.getTime();
      const breached = t.dueAt && t.completedAt! > t.dueAt ? 1 : 0;
      const existing = stepMap.get(t.stepName) ?? { totalMs: 0, count: 0, breached: 0 };
      stepMap.set(t.stepName, {
        totalMs: existing.totalMs + ms,
        count: existing.count + 1,
        breached: existing.breached + breached,
      });
    }

    const byStep = Array.from(stepMap.entries()).map(([stepName, stats]) => ({
      stepName,
      avgCompletionHours: Math.round((stats.totalMs / stats.count / (1000 * 60 * 60)) * 10) / 10,
      taskCount: stats.count,
      breachRate: stats.count > 0 ? Math.round((stats.breached / stats.count) * 100) : 0,
    })).sort((a, b) => b.avgCompletionHours - a.avgCompletionHours);

    // ----------------------------------------------------------------
    // 4. SLA breach rate per assignee
    // ----------------------------------------------------------------
    const assigneeMap = new Map<string, { name: string; total: number; breached: number }>();
    for (const t of completedTasks) {
      // We need assignee info — re-query with assignee
    }

    const completedTasksWithAssignee = await db.workflowTask.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { not: null },
        instance: { startedAt: { gte: from, lte: to }, ...(templateId ? { templateId } : {}) },
      },
      select: {
        assignedAt: true,
        completedAt: true,
        dueAt: true,
        assignee: { select: { id: true, name: true, displayName: true } },
      },
    });

    for (const t of completedTasksWithAssignee) {
      if (!t.assignee) continue;
      const name = t.assignee.displayName ?? t.assignee.name;
      const breached = t.dueAt && t.completedAt! > t.dueAt ? 1 : 0;
      const existing = assigneeMap.get(t.assignee.id) ?? { name, total: 0, breached: 0 };
      assigneeMap.set(t.assignee.id, {
        name,
        total: existing.total + 1,
        breached: existing.breached + breached,
      });
    }

    const slaBreachRate = Array.from(assigneeMap.entries()).map(([assigneeId, stats]) => ({
      assigneeId,
      assigneeName: stats.name,
      tasksCompleted: stats.total,
      tasksBreached: stats.breached,
      breachRate: stats.total > 0 ? Math.round((stats.breached / stats.total) * 100) : 0,
    })).sort((a, b) => b.breachRate - a.breachRate);

    // ----------------------------------------------------------------
    // 5. Peak load — task creation by day-of-week and hour-of-day
    // ----------------------------------------------------------------
    const allTasks = await db.workflowTask.findMany({
      where: {
        assignedAt: { gte: from, lte: to },
        instance: { ...(templateId ? { templateId } : {}) },
      },
      select: { assignedAt: true },
    });

    const dayLoad = new Array(7).fill(0);  // 0=Sun..6=Sat
    const hourLoad = new Array(24).fill(0);
    for (const t of allTasks) {
      dayLoad[t.assignedAt.getDay()]++;
      hourLoad[t.assignedAt.getHours()]++;
    }

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const peakLoad = {
      byDayOfWeek: dayLoad.map((count, i) => ({ day: DAY_NAMES[i], count })),
      byHourOfDay: hourLoad.map((count, h) => ({ hour: h, count })),
    };

    // ----------------------------------------------------------------
    // 6. Funnel completion — % reaching each step in order
    // ----------------------------------------------------------------
    const funnelMap = new Map<number, { stepName: string; reached: number }>();
    const allFunnelTasks = await db.workflowTask.findMany({
      where: {
        stepIndex: { gte: 0 },
        instance: { startedAt: { gte: from, lte: to }, ...(templateId ? { templateId } : {}) },
      },
      select: { stepIndex: true, stepName: true },
    });

    for (const t of allFunnelTasks) {
      if (!funnelMap.has(t.stepIndex)) {
        funnelMap.set(t.stepIndex, { stepName: t.stepName, reached: 0 });
      }
      funnelMap.get(t.stepIndex)!.reached++;
    }

    const funnelSteps = Array.from(funnelMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepIndex, data]) => ({
        stepIndex,
        stepName: data.stepName,
        reached: data.reached,
        reachRate: total > 0 ? Math.round((data.reached / total) * 100) : 0,
      }));

    return NextResponse.json(
      serialise({
        period: { from, to },
        summary: {
          total,
          completed,
          rejected,
          cancelled,
          inProgress,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
          avgCycleDays: Math.round(avgCycleDays * 10) / 10,
        },
        byTemplate,
        byStep,
        slaBreachRate,
        peakLoad,
        funnelCompletion: funnelSteps,
      })
    );
  } catch (error) {
    logger.error("Failed to compute workflow analytics", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
