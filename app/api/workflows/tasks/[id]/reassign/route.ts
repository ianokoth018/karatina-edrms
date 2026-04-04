import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * POST /api/workflows/tasks/[id]/reassign
 * Reassign a pending task to another user without completing it.
 * Body: { newAssigneeId: string, reason: string }
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

    const { id } = await params;
    const body = await req.json();
    const { newAssigneeId, reason } = body as {
      newAssigneeId: string;
      reason: string;
    };

    if (!newAssigneeId || !reason) {
      return NextResponse.json(
        { error: "newAssigneeId and reason are required" },
        { status: 400 }
      );
    }

    // Get the task
    const task = await db.workflowTask.findUnique({
      where: { id },
      include: {
        instance: {
          select: { id: true, subject: true, initiatedById: true },
        },
        assignee: { select: { id: true, name: true } },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "PENDING") {
      return NextResponse.json(
        { error: "Only pending tasks can be reassigned" },
        { status: 400 }
      );
    }

    // Verify the new assignee exists and is active
    const newAssignee = await db.user.findUnique({
      where: { id: newAssigneeId },
      select: { id: true, name: true, isActive: true },
    });

    if (!newAssignee || !newAssignee.isActive) {
      return NextResponse.json(
        { error: "New assignee not found or inactive" },
        { status: 404 }
      );
    }

    const previousAssigneeId = task.assigneeId;
    const previousAssigneeName = task.assignee.name;

    // Update the task's assigneeId
    const updatedTask = await db.workflowTask.update({
      where: { id },
      data: { assigneeId: newAssigneeId },
      include: {
        instance: {
          include: {
            template: { select: { id: true, name: true } },
            document: {
              select: { id: true, title: true, referenceNumber: true },
            },
          },
        },
        assignee: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    // Create workflow event
    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_REASSIGNED",
        actorId: session.user.id,
        data: {
          taskId: id,
          stepName: task.stepName,
          stepIndex: task.stepIndex,
          previousAssigneeId,
          previousAssigneeName,
          newAssigneeId,
          newAssigneeName: newAssignee.name,
          reason,
        },
      },
    });

    // Notify the new assignee
    await db.notification.create({
      data: {
        userId: newAssigneeId,
        type: "WORKFLOW_TASK",
        title: "Workflow task reassigned to you",
        body: `You have been assigned step "${task.stepName}" for: ${task.instance.subject}. Reason: ${reason}`,
        linkUrl: "/workflows",
      },
    });

    // Write audit log
    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TASK_REASSIGNED",
      resourceType: "workflow_task",
      resourceId: id,
      metadata: {
        instanceId: task.instanceId,
        stepName: task.stepName,
        previousAssigneeId,
        newAssigneeId,
        reason,
      },
    });

    return NextResponse.json(serialise({ task: updatedTask }));
  } catch (error) {
    logger.error("Failed to reassign workflow task", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
