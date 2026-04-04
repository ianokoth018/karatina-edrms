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
 * GET /api/workflows/tasks/[id]
 * Get a single workflow task with its instance, template, document (incl. files), and assignee.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const task = await db.workflowTask.findUnique({
      where: { id },
      include: {
        instance: {
          include: {
            template: {
              select: {
                id: true,
                name: true,
                description: true,
                definition: true,
              },
            },
            document: {
              include: {
                files: {
                  select: {
                    id: true,
                    storagePath: true,
                    fileName: true,
                    mimeType: true,
                    sizeBytes: true,
                    uploadedAt: true,
                  },
                },
              },
            },
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            displayName: true,
            email: true,
            department: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(serialise({ task }));
  } catch (error) {
    logger.error("Failed to fetch workflow task", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workflows/tasks/[id]
 * Perform an action on a workflow task.
 * Body: { action: "APPROVED" | "REJECTED" | "RETURNED" | "DELEGATED", comment: string, delegateToUserId?: string, reason?: string }
 */
export async function PATCH(
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
    const { action, comment, delegateToUserId, reason } = body as {
      action: "APPROVED" | "REJECTED" | "RETURNED" | "DELEGATED";
      comment: string;
      delegateToUserId?: string;
      reason?: string;
    };

    if (!action || !comment) {
      return NextResponse.json(
        { error: "Action and comment are required" },
        { status: 400 }
      );
    }

    const validActions = ["APPROVED", "REJECTED", "RETURNED", "DELEGATED"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        {
          error:
            "Invalid action. Must be APPROVED, REJECTED, RETURNED, or DELEGATED",
        },
        { status: 400 }
      );
    }

    if (action === "DELEGATED" && !delegateToUserId) {
      return NextResponse.json(
        { error: "delegateToUserId is required for delegation" },
        { status: 400 }
      );
    }

    // Get the task with instance and all tasks
    const task = await db.workflowTask.findUnique({
      where: { id },
      include: {
        instance: {
          include: {
            tasks: {
              orderBy: { stepIndex: "asc" },
              include: {
                assignee: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify the current user is the assignee
    if (task.assigneeId !== session.user.id) {
      return NextResponse.json(
        { error: "You are not assigned to this task" },
        { status: 403 }
      );
    }

    if (task.status !== "PENDING") {
      return NextResponse.json(
        { error: "This task has already been completed" },
        { status: 400 }
      );
    }

    const allTasks = task.instance.tasks;
    const currentIndex = allTasks.findIndex((t) => t.id === id);
    const isLastStep = currentIndex === allTasks.length - 1;

    // 1. Update the current task
    await db.workflowTask.update({
      where: { id },
      data: {
        status: "COMPLETED",
        action,
        comment,
        completedAt: new Date(),
      },
    });

    // 2. Create a workflow event
    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: `TASK_${action}`,
        actorId: session.user.id,
        data: {
          taskId: id,
          stepName: task.stepName,
          stepIndex: task.stepIndex,
          action,
          comment,
        },
      },
    });

    let notificationUserId: string | null = null;
    let notificationTitle = "";
    let notificationBody = "";

    if (action === "APPROVED") {
      if (isLastStep) {
        // All steps completed -- mark workflow as COMPLETED
        await db.workflowInstance.update({
          where: { id: task.instanceId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        // Notify the initiator
        notificationUserId = task.instance.initiatedById;
        notificationTitle = "Workflow completed";
        notificationBody = `Workflow "${task.instance.subject}" has been approved and completed.`;
      } else {
        // Move to next step
        const nextTask = allTasks[currentIndex + 1];
        if (nextTask) {
          await db.workflowInstance.update({
            where: { id: task.instanceId },
            data: { currentStepIndex: nextTask.stepIndex },
          });

          // Notify the next assignee
          notificationUserId = nextTask.assigneeId;
          notificationTitle = "New workflow task assigned";
          notificationBody = `You have been assigned step "${nextTask.stepName}" for: ${task.instance.subject}`;
        }
      }
    } else if (action === "REJECTED") {
      // Mark the entire workflow as REJECTED
      await db.workflowInstance.update({
        where: { id: task.instanceId },
        data: {
          status: "REJECTED",
          completedAt: new Date(),
        },
      });

      // Skip remaining tasks
      await db.workflowTask.updateMany({
        where: {
          instanceId: task.instanceId,
          status: "PENDING",
          id: { not: id },
        },
        data: { status: "SKIPPED" },
      });

      // Notify the initiator
      notificationUserId = task.instance.initiatedById;
      notificationTitle = "Workflow rejected";
      notificationBody = `Workflow "${task.instance.subject}" was rejected at step "${task.stepName}". Comment: ${comment}`;
    } else if (action === "RETURNED") {
      // Return to previous step
      if (currentIndex > 0) {
        const prevTask = allTasks[currentIndex - 1];
        // Create a new task for the previous assignee
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + 7);

        await db.workflowTask.create({
          data: {
            instanceId: task.instanceId,
            stepName: `${prevTask.stepName} (Revision)`,
            stepIndex: prevTask.stepIndex,
            assigneeId: prevTask.assigneeId,
            status: "PENDING",
            dueAt,
          },
        });

        await db.workflowInstance.update({
          where: { id: task.instanceId },
          data: { currentStepIndex: prevTask.stepIndex },
        });

        // Notify the previous assignee
        notificationUserId = prevTask.assigneeId;
        notificationTitle = "Workflow returned for revision";
        notificationBody = `Step "${task.stepName}" of "${task.instance.subject}" was returned for revision. Comment: ${comment}`;
      } else {
        // If first step, return to initiator
        notificationUserId = task.instance.initiatedById;
        notificationTitle = "Workflow returned for revision";
        notificationBody = `The first step "${task.stepName}" of "${task.instance.subject}" was returned. Comment: ${comment}`;
      }
    } else if (action === "DELEGATED") {
      // Delegate the task to another user
      const delegateUser = await db.user.findUnique({
        where: { id: delegateToUserId! },
        select: { id: true, name: true, isActive: true },
      });

      if (!delegateUser || !delegateUser.isActive) {
        return NextResponse.json(
          { error: "Delegate user not found or inactive" },
          { status: 404 }
        );
      }

      // Create a Delegation record (active for 30 days)
      const startsAt = new Date();
      const endsAt = new Date();
      endsAt.setDate(endsAt.getDate() + 30);

      await db.delegation.create({
        data: {
          delegatorId: session.user.id,
          delegateId: delegateToUserId!,
          reason: reason || comment,
          startsAt,
          endsAt,
          isActive: true,
        },
      });

      // Create a new task for the delegate user (same step, same instance)
      const dueAt = task.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.workflowTask.create({
        data: {
          instanceId: task.instanceId,
          stepName: `${task.stepName} (Delegated)`,
          stepIndex: task.stepIndex,
          assigneeId: delegateToUserId!,
          status: "PENDING",
          dueAt,
        },
      });

      // Notify the delegate
      notificationUserId = delegateToUserId!;
      notificationTitle = "Workflow task delegated to you";
      notificationBody = `${session.user.name} delegated step "${task.stepName}" of "${task.instance.subject}" to you. Reason: ${reason || comment}`;
    }

    // Send notification
    if (notificationUserId) {
      await db.notification.create({
        data: {
          userId: notificationUserId,
          type: "WORKFLOW_TASK",
          title: notificationTitle,
          body: notificationBody,
          linkUrl: "/workflows",
        },
      });
    }

    await writeAudit({
      userId: session.user.id,
      action: `WORKFLOW_TASK_${action}`,
      resourceType: "workflow_task",
      resourceId: id,
      metadata: {
        instanceId: task.instanceId,
        stepName: task.stepName,
        comment,
      },
    });

    // Re-fetch the updated task
    const updatedTask = await db.workflowTask.findUnique({
      where: { id },
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

    return NextResponse.json(serialise({ task: updatedTask }));
  } catch (error) {
    logger.error("Failed to process workflow task action", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
