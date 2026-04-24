import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { advanceWorkflow } from "@/lib/workflow-engine";
import { validateTaskFormData } from "@/lib/workflow-form-validator";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/workflows/tasks/[id]
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
              select: { id: true, name: true, description: true, definition: true },
            },
            document: {
              include: {
                files: {
                  select: {
                    id: true, storagePath: true, fileName: true,
                    mimeType: true, sizeBytes: true, uploadedAt: true,
                  },
                },
              },
            },
          },
        },
        assignee: {
          select: { id: true, name: true, displayName: true, email: true, department: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Allow assignee OR instance initiator to read the task
    const isAssignee = task.assigneeId === session.user.id;
    const isInitiator = task.instance.initiatedById === session.user.id;
    if (!isAssignee && !isInitiator) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(serialise({ task }));
  } catch (error) {
    logger.error("Failed to fetch workflow task", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/workflows/tasks/[id]
 * Body: { action, comment, delegateToUserId?, reason?, formData? }
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
    const {
      action,
      comment,
      delegateToUserId,
      reason,
      formData,
    } = body as {
      action: "APPROVED" | "REJECTED" | "RETURNED" | "DELEGATED";
      comment: string;
      delegateToUserId?: string;
      reason?: string;
      formData?: Record<string, unknown>;
    };

    if (!action || !comment) {
      return NextResponse.json({ error: "action and comment are required" }, { status: 400 });
    }

    const validActions = ["APPROVED", "REJECTED", "RETURNED", "DELEGATED"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (action === "DELEGATED" && !delegateToUserId) {
      return NextResponse.json({ error: "delegateToUserId is required for delegation" }, { status: 400 });
    }

    const task = await db.workflowTask.findUnique({
      where: { id },
      include: {
        instance: {
          select: {
            id: true,
            subject: true,
            initiatedById: true,
            templateId: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.assigneeId !== session.user.id) {
      return NextResponse.json({ error: "You are not assigned to this task" }, { status: 403 });
    }

    if (task.status !== "PENDING") {
      return NextResponse.json({ error: "This task has already been actioned" }, { status: 400 });
    }

    // Validate form data against the task node's linked FormTemplate (if any)
    if (formData && Object.keys(formData).length > 0) {
      const validationErrors = await validateTaskFormData({
        taskNodeId: task.nodeId,
        instanceId: task.instanceId,
        formData,
      });
      if (validationErrors && validationErrors.length > 0) {
        return NextResponse.json(
          { error: "Form validation failed", fields: validationErrors },
          { status: 422 }
        );
      }
    }

    // Mark the task completed with its action
    await db.workflowTask.update({
      where: { id },
      data: {
        status: "COMPLETED",
        action,
        comment,
        completedAt: new Date(),
      },
    });

    // Record audit event
    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: `TASK_${action}`,
        actorId: session.user.id,
        data: { taskId: id, stepName: task.stepName, action, comment } as object,
      },
    });

    // ----------------------------------------------------------------
    // DELEGATED — special path: does not advance the graph.
    // Creates a delegation record and a new sibling task for the delegate.
    // ----------------------------------------------------------------
    if (action === "DELEGATED") {
      const delegateUser = await db.user.findUnique({
        where: { id: delegateToUserId! },
        select: { id: true, name: true, isActive: true },
      });

      if (!delegateUser?.isActive) {
        return NextResponse.json({ error: "Delegate user not found or inactive" }, { status: 404 });
      }

      const now = new Date();
      const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await db.delegation.create({
        data: {
          delegatorId: session.user.id,
          delegateId: delegateToUserId!,
          reason: reason ?? comment,
          startsAt: now,
          endsAt,
          isActive: true,
        },
      });

      const dueAt = task.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.workflowTask.create({
        data: {
          instanceId: task.instanceId,
          nodeId: task.nodeId,
          stepName: `${task.stepName} (Delegated)`,
          stepIndex: task.stepIndex,
          assigneeId: delegateToUserId!,
          status: "PENDING",
          dueAt,
        },
      });

      await db.notification.create({
        data: {
          userId: delegateToUserId!,
          type: "WORKFLOW_TASK",
          title: "Workflow task delegated to you",
          body: `${session.user.name} delegated "${task.stepName}" for "${task.instance.subject}" to you. Reason: ${reason ?? comment}`,
          linkUrl: "/workflows",
        },
      });
    } else {
      // ----------------------------------------------------------------
      // APPROVED / REJECTED / RETURNED — advance via graph engine
      // ----------------------------------------------------------------
      await advanceWorkflow({
        instanceId: task.instanceId,
        completedTaskId: id,
        action: action as "APPROVED" | "REJECTED" | "RETURNED",
        actorId: session.user.id,
        comment,
        formData,
      });
    }

    await writeAudit({
      userId: session.user.id,
      action: `WORKFLOW_TASK_${action}`,
      resourceType: "workflow_task",
      resourceId: id,
      metadata: { instanceId: task.instanceId, stepName: task.stepName, comment },
    });

    const updatedTask = await db.workflowTask.findUnique({
      where: { id },
      include: {
        instance: {
          include: {
            template: { select: { id: true, name: true } },
            document: { select: { id: true, title: true, referenceNumber: true } },
          },
        },
        assignee: { select: { id: true, name: true, displayName: true } },
      },
    });

    return NextResponse.json(serialise({ task: updatedTask }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    // Surface concurrency conflict as 409
    if (msg.includes("Concurrent modification")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    logger.error("Failed to process workflow task action", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
