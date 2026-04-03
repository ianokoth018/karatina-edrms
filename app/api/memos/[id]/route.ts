import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/memos/[id] -- fetch a single memo with full details
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const memo = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, name: true } },
        document: {
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            status: true,
            files: {
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
            },
          },
        },
        tasks: {
          orderBy: { stepIndex: "asc" },
          include: {
            assignee: {
              select: {
                id: true,
                name: true,
                displayName: true,
                department: true,
                jobTitle: true,
              },
            },
          },
        },
        events: {
          orderBy: { occurredAt: "asc" },
        },
      },
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    // Check user involvement
    const userId = session.user.id;
    const isInvolved =
      memo.initiatedById === userId ||
      memo.tasks.some((t) => t.assigneeId === userId);

    if (!isInvolved) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const formData = memo.formData as Record<string, unknown>;

    // Find the current pending task for this user (if any)
    const currentUserPendingTask = memo.tasks.find(
      (t) => t.assigneeId === userId && t.status === "PENDING"
    );

    // Determine if this task is the "active" task (lowest pending step index)
    const lowestPendingIndex = Math.min(
      ...memo.tasks.filter((t) => t.status === "PENDING").map((t) => t.stepIndex)
    );
    const isCurrentUsersTurn =
      currentUserPendingTask?.stepIndex === lowestPendingIndex;

    // Compute memo status
    let memoStatus = "DRAFT";
    if (memo.status === "COMPLETED") {
      memoStatus = "APPROVED";
    } else if (memo.status === "REJECTED") {
      memoStatus = "REJECTED";
    } else if (memo.status === "CANCELLED") {
      memoStatus = "CANCELLED";
    } else {
      const returnEvents = memo.events.filter(
        (e) => (e.data as Record<string, unknown>)?.action === "RETURNED"
      );
      if (returnEvents.length > 0 && memo.currentStepIndex === 0) {
        memoStatus = "RETURNED";
      } else {
        const currentTask = memo.tasks.find(
          (t) => t.status === "PENDING" && t.stepIndex === lowestPendingIndex
        );
        if (currentTask?.stepName === "Final Approval") {
          memoStatus = "PENDING_APPROVAL";
        } else if (currentTask?.stepName?.startsWith("Recommendation")) {
          memoStatus = "PENDING_RECOMMENDATION";
        } else {
          memoStatus = "DRAFT";
        }
      }
    }

    // Build enriched response
    const enriched = {
      id: memo.id,
      referenceNumber: memo.document?.referenceNumber ?? memo.referenceNumber,
      workflowReference: memo.referenceNumber,
      subject: memo.subject,
      body: formData?.body ?? "",
      status: memoStatus,
      workflowStatus: memo.status,
      from: {
        id: formData?.fromId ?? memo.initiatedById,
        name: formData?.fromName ?? "",
        department: formData?.fromDepartment ?? "",
        jobTitle: formData?.fromJobTitle ?? "",
      },
      to: {
        id: formData?.toId ?? "",
        name: formData?.toName ?? "",
        department: formData?.toDepartment ?? "",
        jobTitle: formData?.toJobTitle ?? "",
      },
      startedAt: memo.startedAt,
      completedAt: memo.completedAt,
      tasks: memo.tasks.map((task) => ({
        id: task.id,
        stepName: task.stepName,
        stepIndex: task.stepIndex,
        status: task.status,
        action: task.action,
        comment: task.comment,
        assignee: task.assignee,
        assignedAt: task.assignedAt,
        completedAt: task.completedAt,
      })),
      events: memo.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorId: event.actorId,
        data: event.data,
        occurredAt: event.occurredAt,
      })),
      document: memo.document,
      canAct: isCurrentUsersTurn,
      currentAction: currentUserPendingTask
        ? {
            taskId: currentUserPendingTask.id,
            stepName: currentUserPendingTask.stepName,
            type: currentUserPendingTask.stepName === "Final Approval"
              ? "APPROVE"
              : "RECOMMEND",
          }
        : null,
      initiatedById: memo.initiatedById,
      isInitiator: memo.initiatedById === userId,
      departmentOffice: (formData?.departmentOffice as string) ?? "",
      designation: (formData?.designation as string) ?? "",
      cc: (formData?.cc as string[]) ?? [],
    };

    return NextResponse.json(enriched);
  } catch (error) {
    logger.error("Failed to fetch memo", error, {
      route: "/api/memos/[id]",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/memos/[id] -- process a memo action
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action, comment } = body as {
      action: "RECOMMEND" | "APPROVE" | "REJECT" | "RETURN";
      comment?: string;
    };

    const validActions = ["RECOMMEND", "APPROVE", "REJECT", "RETURN"];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be RECOMMEND, APPROVE, REJECT, or RETURN" },
        { status: 400 }
      );
    }

    if ((action === "REJECT" || action === "RETURN") && !comment?.trim()) {
      return NextResponse.json(
        { error: "Comment is required when rejecting or returning a memo" },
        { status: 400 }
      );
    }

    // Fetch the memo instance with tasks
    const memo = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { stepIndex: "asc" },
          include: {
            assignee: {
              select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
            },
          },
        },
        document: {
          select: { id: true, referenceNumber: true },
        },
      },
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    if (memo.status === "COMPLETED" || memo.status === "REJECTED" || memo.status === "CANCELLED") {
      return NextResponse.json(
        { error: "This memo has already been finalized" },
        { status: 400 }
      );
    }

    // Find the current user's pending task
    const userId = session.user.id;
    const pendingTasks = memo.tasks.filter((t) => t.status === "PENDING");
    const lowestPendingIndex = Math.min(...pendingTasks.map((t) => t.stepIndex));
    const currentTask = pendingTasks.find(
      (t) => t.assigneeId === userId && t.stepIndex === lowestPendingIndex
    );

    if (!currentTask) {
      return NextResponse.json(
        { error: "You do not have a pending action on this memo" },
        { status: 403 }
      );
    }

    // Validate action type against step
    if (action === "APPROVE" && currentTask.stepName !== "Final Approval") {
      return NextResponse.json(
        { error: "Only the final approver can use the APPROVE action. Use RECOMMEND instead." },
        { status: 400 }
      );
    }
    if (action === "RECOMMEND" && currentTask.stepName === "Final Approval") {
      return NextResponse.json(
        { error: "The final approver should use APPROVE, not RECOMMEND." },
        { status: 400 }
      );
    }

    const formData = memo.formData as Record<string, unknown>;
    const initiator = await db.user.findUnique({
      where: { id: memo.initiatedById },
      select: { id: true, displayName: true },
    });

    // Process the action
    const taskAction = action === "RECOMMEND" || action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "RETURNED";

    await db.$transaction(async (tx) => {
      // 1. Complete the current task
      await tx.workflowTask.update({
        where: { id: currentTask.id },
        data: {
          status: "COMPLETED",
          action: taskAction,
          comment: comment?.trim() || null,
          completedAt: new Date(),
        },
      });

      // 2. Create workflow event
      await tx.workflowEvent.create({
        data: {
          instanceId: memo.id,
          eventType: `MEMO_${action}`,
          actorId: userId,
          data: {
            taskId: currentTask.id,
            stepName: currentTask.stepName,
            stepIndex: currentTask.stepIndex,
            action: taskAction,
            comment: comment?.trim() || null,
            actorName: session.user.name,
          },
        },
      });

      if (action === "RECOMMEND") {
        // Move to next step
        const nextTask = pendingTasks.find(
          (t) => t.stepIndex > currentTask.stepIndex
        );
        if (nextTask) {
          await tx.workflowInstance.update({
            where: { id: memo.id },
            data: { currentStepIndex: nextTask.stepIndex },
          });

          // Notify next person
          await tx.notification.create({
            data: {
              userId: nextTask.assigneeId,
              type: "MEMO_ACTION_REQUIRED",
              title: "Memo Requires Your Action",
              body: `A memo "${memo.subject}" has been recommended and now requires your ${nextTask.stepName === "Final Approval" ? "approval" : "recommendation"}.`,
              linkUrl: `/memos/${memo.id}`,
            },
          });
        }
      } else if (action === "APPROVE") {
        // Final approval -- complete the workflow
        await tx.workflowInstance.update({
          where: { id: memo.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        // Archive the document
        if (memo.documentId) {
          await tx.document.update({
            where: { id: memo.documentId },
            data: { status: "ARCHIVED" },
          });
        }

        // Notify the initiator
        if (initiator) {
          await tx.notification.create({
            data: {
              userId: initiator.id,
              type: "MEMO_APPROVED",
              title: "Memo Approved",
              body: `Your memo "${memo.subject}" (${formData?.memoReference}) has been approved by ${(formData?.toName as string) ?? "the approver"}.`,
              linkUrl: `/memos/${memo.id}`,
            },
          });
        }
      } else if (action === "REJECT") {
        // Reject the entire memo
        await tx.workflowInstance.update({
          where: { id: memo.id },
          data: {
            status: "REJECTED",
            completedAt: new Date(),
          },
        });

        // Skip remaining pending tasks
        await tx.workflowTask.updateMany({
          where: {
            instanceId: memo.id,
            status: "PENDING",
            id: { not: currentTask.id },
          },
          data: { status: "SKIPPED" },
        });

        // Notify the initiator
        if (initiator) {
          await tx.notification.create({
            data: {
              userId: initiator.id,
              type: "MEMO_REJECTED",
              title: "Memo Rejected",
              body: `Your memo "${memo.subject}" has been rejected by ${session.user.name}. Reason: ${comment}`,
              linkUrl: `/memos/${memo.id}`,
            },
          });
        }
      } else if (action === "RETURN") {
        // Return to initiator for revision
        // Reset to step 0
        await tx.workflowInstance.update({
          where: { id: memo.id },
          data: { currentStepIndex: 0 },
        });

        // Reset all pending tasks' status remains PENDING
        // But we need to re-create the chain from the beginning
        // Mark remaining PENDING tasks as SKIPPED
        await tx.workflowTask.updateMany({
          where: {
            instanceId: memo.id,
            status: "PENDING",
            id: { not: currentTask.id },
          },
          data: { status: "SKIPPED" },
        });

        // Create new tasks for the entire chain (re-do)
        const originalTasks = memo.tasks.filter(
          (t) => t.stepName !== "Self-Review" && t.id !== currentTask.id
        );

        // Re-create Self-Review task for initiator
        await tx.workflowTask.create({
          data: {
            instanceId: memo.id,
            stepName: "Self-Review (Revision)",
            stepIndex: 0,
            assigneeId: memo.initiatedById,
            status: "PENDING",
          },
        });

        // Re-create all subsequent tasks
        for (const origTask of originalTasks) {
          if (origTask.status === "SKIPPED" || origTask.status === "PENDING") {
            // Already handled by updateMany above
            continue;
          }
          // Re-create completed tasks that need re-doing
          await tx.workflowTask.create({
            data: {
              instanceId: memo.id,
              stepName: origTask.stepName,
              stepIndex: origTask.stepIndex,
              assigneeId: origTask.assigneeId,
              status: "PENDING",
            },
          });
        }

        // Also re-create the current task and any after it for the redo
        const currentAndAfter = memo.tasks.filter(
          (t) => t.stepIndex >= currentTask.stepIndex && t.id !== currentTask.id
        );
        for (const t of currentAndAfter) {
          await tx.workflowTask.create({
            data: {
              instanceId: memo.id,
              stepName: t.stepName,
              stepIndex: t.stepIndex,
              assigneeId: t.assigneeId,
              status: "PENDING",
            },
          });
        }

        // Notify the initiator
        if (initiator) {
          await tx.notification.create({
            data: {
              userId: initiator.id,
              type: "MEMO_RETURNED",
              title: "Memo Returned for Revision",
              body: `Your memo "${memo.subject}" has been returned by ${session.user.name}. Comment: ${comment}`,
              linkUrl: `/memos/${memo.id}`,
            },
          });
        }
      }
    });

    // Audit log
    await writeAudit({
      userId: session.user.id,
      action: `memo.${action.toLowerCase()}`,
      resourceType: "Memo",
      resourceId: memo.id,
      metadata: {
        taskId: currentTask.id,
        stepName: currentTask.stepName,
        memoReference: formData?.memoReference,
        comment: comment?.trim(),
      },
    });

    return NextResponse.json({ success: true, action });
  } catch (error) {
    logger.error("Failed to process memo action", error, {
      route: "/api/memos/[id]",
      method: "PATCH",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
