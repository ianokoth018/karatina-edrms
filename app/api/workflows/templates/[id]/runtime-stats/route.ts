import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/workflows/templates/[id]/runtime-stats
 *
 * Aggregates per-step task stats for a single template, keyed by
 * `nodeId` (preferred) with `stepName` as fallback. The designer
 * overlays these onto the canvas so admins can spot bottlenecks
 * without leaving the editor.
 *
 * Optional query params:
 *   ?days=N     Window the stats to the last N days (default: all-time).
 *
 * Shape:
 *   {
 *     totalInstances: number,
 *     completedInstances: number,
 *     windowDays: number | null,
 *     byNode: { [keyId]: NodeStats },
 *     byStepName: { [stepName]: NodeStats }  // fallback lookup
 *   }
 *
 * NodeStats:
 *   total       — tasks that have reached this step
 *   completed   — tasks completed (any action)
 *   pending     — still pending or in-progress
 *   approved    — completed with action APPROVED
 *   rejected    — completed with action REJECTED
 *   returned    — completed with action RETURNED
 *   avgDwellMs  — mean (completedAt - assignedAt) over completed tasks
 *   breaches    — completed past dueAt OR pending past dueAt
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const url = new URL(req.url);
    const daysParam = url.searchParams.get("days");
    const windowDays = daysParam ? Number(daysParam) : null;
    const since =
      windowDays && Number.isFinite(windowDays) && windowDays > 0
        ? new Date(Date.now() - windowDays * 86400_000)
        : null;

    const template = await db.workflowTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Pull all tasks for instances of this template. We rely on the
    // template->instance relation to scope the query so a single index
    // hit is enough.
    const tasks = await db.workflowTask.findMany({
      where: {
        instance: {
          templateId: id,
          ...(since ? { startedAt: { gte: since } } : {}),
        },
      },
      select: {
        nodeId: true,
        stepName: true,
        status: true,
        action: true,
        assignedAt: true,
        completedAt: true,
        dueAt: true,
      },
    });

    const instances = await db.workflowInstance.count({
      where: {
        templateId: id,
        ...(since ? { startedAt: { gte: since } } : {}),
      },
    });
    const completedInstances = await db.workflowInstance.count({
      where: {
        templateId: id,
        status: "COMPLETED",
        ...(since ? { startedAt: { gte: since } } : {}),
      },
    });

    type Bucket = {
      total: number;
      completed: number;
      pending: number;
      approved: number;
      rejected: number;
      returned: number;
      breaches: number;
      dwellSumMs: number;
      dwellCount: number;
    };
    const emptyBucket = (): Bucket => ({
      total: 0,
      completed: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      returned: 0,
      breaches: 0,
      dwellSumMs: 0,
      dwellCount: 0,
    });

    const byNode = new Map<string, Bucket>();
    const byStepName = new Map<string, Bucket>();
    const now = Date.now();

    for (const t of tasks) {
      const bucketsForTask: Bucket[] = [];
      if (t.nodeId) {
        if (!byNode.has(t.nodeId)) byNode.set(t.nodeId, emptyBucket());
        bucketsForTask.push(byNode.get(t.nodeId)!);
      }
      if (t.stepName) {
        if (!byStepName.has(t.stepName)) byStepName.set(t.stepName, emptyBucket());
        bucketsForTask.push(byStepName.get(t.stepName)!);
      }
      if (bucketsForTask.length === 0) continue;

      const isCompleted = t.status === "COMPLETED" && !!t.completedAt;
      const completedTs = t.completedAt ? t.completedAt.getTime() : null;
      const assignedTs = t.assignedAt ? t.assignedAt.getTime() : null;
      const dueTs = t.dueAt ? t.dueAt.getTime() : null;

      for (const b of bucketsForTask) {
        b.total += 1;
        if (isCompleted) {
          b.completed += 1;
          if (t.action === "APPROVED") b.approved += 1;
          else if (t.action === "REJECTED") b.rejected += 1;
          else if (t.action === "RETURNED") b.returned += 1;
          if (assignedTs !== null && completedTs !== null) {
            b.dwellSumMs += completedTs - assignedTs;
            b.dwellCount += 1;
          }
          if (dueTs !== null && completedTs !== null && completedTs > dueTs) {
            b.breaches += 1;
          }
        } else {
          b.pending += 1;
          if (dueTs !== null && now > dueTs) {
            b.breaches += 1;
          }
        }
      }
    }

    function freeze(b: Bucket) {
      const { dwellSumMs, dwellCount, ...rest } = b;
      return {
        ...rest,
        avgDwellMs: dwellCount > 0 ? Math.round(dwellSumMs / dwellCount) : 0,
      };
    }

    const byNodeObj: Record<string, ReturnType<typeof freeze>> = {};
    for (const [k, v] of byNode) byNodeObj[k] = freeze(v);
    const byStepNameObj: Record<string, ReturnType<typeof freeze>> = {};
    for (const [k, v] of byStepName) byStepNameObj[k] = freeze(v);

    return NextResponse.json({
      totalInstances: instances,
      completedInstances,
      windowDays,
      byNode: byNodeObj,
      byStepName: byStepNameObj,
    });
  } catch (error) {
    logger.error("Failed to fetch workflow runtime stats", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
