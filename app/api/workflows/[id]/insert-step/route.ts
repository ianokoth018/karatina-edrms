import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/workflows/[id]/insert-step
 * Insert an ad-hoc approval step into a running workflow.
 *
 * Body: { assigneeId, stepName, insertAfterStepIndex?, slaHours?, reason }
 *
 * Requires: workflows:manage permission or Admin role.
 * The new task is injected after `insertAfterStepIndex` (defaults to current
 * step). All subsequent tasks have their stepIndex shifted up by 1.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");

    if (!hasPermission) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: instanceId } = await params;
    const body = await req.json();
    const { assigneeId, stepName, insertAfterStepIndex, slaHours, reason } = body as {
      assigneeId: string;
      stepName: string;
      insertAfterStepIndex?: number;
      slaHours?: number;
      reason?: string;
    };

    if (!assigneeId || !stepName) {
      return NextResponse.json({ error: "assigneeId and stepName are required" }, { status: 400 });
    }

    const instance = await db.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        tasks: { orderBy: { stepIndex: "asc" } },
      },
    });

    if (!instance) {
      return NextResponse.json({ error: "Workflow instance not found" }, { status: 404 });
    }

    if (!["PENDING", "IN_PROGRESS"].includes(instance.status)) {
      return NextResponse.json(
        { error: "Cannot insert a step into a completed, rejected, or cancelled workflow" },
        { status: 400 }
      );
    }

    const assignee = await db.user.findUnique({
      where: { id: assigneeId },
      select: { id: true, isActive: true, name: true, displayName: true },
    });

    if (!assignee?.isActive) {
      return NextResponse.json({ error: "Assignee not found or inactive" }, { status: 404 });
    }

    // Determine insertion point
    const insertAfter = insertAfterStepIndex ?? instance.currentStepIndex;
    const newStepIndex = insertAfter + 1;

    // Shift all tasks at or above the insertion index up by 1
    await db.workflowTask.updateMany({
      where: { instanceId, stepIndex: { gte: newStepIndex } },
      data: { stepIndex: { increment: 1 } },
    });

    const dueAt = slaHours
      ? new Date(Date.now() + slaHours * 60 * 60 * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newTask = await db.workflowTask.create({
      data: {
        instanceId,
        stepName,
        stepIndex: newStepIndex,
        assigneeId,
        status: "PENDING",
        dueAt,
      },
    });

    await db.workflowEvent.create({
      data: {
        instanceId,
        eventType: "WORKFLOW_STEP_INSERTED",
        actorId: session.user.id,
        data: {
          newTaskId: newTask.id,
          stepName,
          insertedAtIndex: newStepIndex,
          assigneeId,
          reason: reason ?? null,
        } as object,
      },
    });

    // Notify the new assignee
    await db.notification.create({
      data: {
        userId: assigneeId,
        type: "WORKFLOW_TASK",
        title: "New workflow task assigned",
        body: `An ad-hoc step "${stepName}" has been inserted into workflow "${instance.subject}" and assigned to you.`,
        linkUrl: "/workflows",
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_STEP_INSERTED",
      resourceType: "workflow_instance",
      resourceId: instanceId,
      metadata: { stepName, insertedAtIndex: newStepIndex, assigneeId, reason },
    });

    logger.info("Ad-hoc step inserted", {
      instanceId, stepName, insertedAtIndex: newStepIndex, assigneeId,
    });

    return NextResponse.json({ task: newTask }, { status: 201 });
  } catch (error) {
    logger.error("Failed to insert workflow step", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
