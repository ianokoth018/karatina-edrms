import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getDocusignConfig } from "@/lib/settings";

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
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true },
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

    // Check user involvement — same rules as the list API:
    // initiator OR has already acted (COMPLETED task) OR is at the current active step (lowest pending stepIndex)
    // Elevated roles (VC / DVC / Director / Dean / Registrar PA / Admin) bypass the filter.
    const userId = session.user.id;
    const userRoles = (session.user.roles as string[] | undefined) ?? [];
    const ELEVATED_READ_ROLES = new Set([
      "VICE_CHANCELLOR", "DVC_PFA", "DVC_ARSA",
      "ADMIN", "DIRECTOR", "DEAN", "REGISTRAR_PA",
    ]);
    const hasElevatedAccess = userRoles.some((r) => ELEVATED_READ_ROLES.has(r));

    const pendingTasksForAccess = memo.tasks.filter((t) => t.status === "PENDING");
    const lowestPendingForAccess =
      pendingTasksForAccess.length > 0
        ? Math.min(...pendingTasksForAccess.map((t) => t.stepIndex))
        : Infinity;
    const isInvolved =
      hasElevatedAccess ||
      memo.initiatedById === userId ||
      memo.tasks.some((t) => t.assigneeId === userId && t.status === "COMPLETED") ||
      pendingTasksForAccess.some(
        (t) => t.assigneeId === userId && t.stepIndex === lowestPendingForAccess
      );

    if (!isInvolved) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    const formData = memo.formData as Record<string, unknown>;

    // Resolve any CC entries that look like user IDs (cuid format) to display names.
    // Free-text entries (department names, titles) are kept as-is.
    const rawCc = Array.isArray((formData as Record<string, unknown>)?.cc)
      ? ((formData as Record<string, unknown>).cc as string[])
      : [];
    const cuidLike = rawCc.filter((c) => typeof c === "string" && /^c[a-z0-9]{20,}$/i.test(c));
    let resolvedCc: string[] = rawCc;
    if (cuidLike.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: cuidLike } },
        select: { id: true, name: true, displayName: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.displayName || u.name]));
      resolvedCc = rawCc.map((c) => nameById.get(c) ?? c);
    }

    // If the memo was endorsed by an HOD, the initiator on record will be the
    // HOD while `originalInitiatedById` still points to the real author. Resolve
    // their display info so the UI can show a secondary "originally drafted by"
    // line.
    let originalInitiatedBy: {
      id: string;
      name: string;
      displayName: string | null;
      department: string | null;
      jobTitle: string | null;
    } | null = null;
    if (
      memo.originalInitiatedById &&
      memo.originalInitiatedById !== memo.initiatedById
    ) {
      originalInitiatedBy = await db.user.findUnique({
        where: { id: memo.originalInitiatedById },
        select: {
          id: true,
          name: true,
          displayName: true,
          department: true,
          jobTitle: true,
        },
      });
    }

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
    const isCommunicating = (formData?.memoType as string) === "communicating";
    let memoStatus = "DRAFT";
    if (isCommunicating && memo.status === "COMPLETED") {
      memoStatus = "SENT";
    } else if (memo.status === "COMPLETED") {
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
      document: memo.document
        ? {
            ...memo.document,
            files: memo.document.files.map((f) => ({
              ...f,
              sizeBytes: Number(f.sizeBytes),
            })),
          }
        : null,
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
      originalInitiatedBy,
      signatureMethod: memo.signatureMethod ?? null,
      docusign: {
        status: memo.docusignStatus ?? null,
        signedAt: memo.docusignSignedAt?.toISOString() ?? null,
        hasSignedPdf: Boolean(memo.docusignSignedPdf),
        envelopeId: memo.docusignEnvelopeId ?? null,
        available: await getDocusignConfig()
          .then((c) => Boolean(c?.enabled))
          .catch(() => false),
      },
      departmentOffice: (formData?.departmentOffice as string) ?? "",
      designation: (formData?.designation as string) ?? "",
      cc: resolvedCc,
      senderIsSuperior: (formData?.senderIsSuperior as boolean) ?? true,
      memoType: (formData?.memoType as string) ?? "administrative",
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
    const { action, comment, clarifyUserId, clarifyDepartment, additionalCc } = body as {
      action: "RECOMMEND" | "APPROVE" | "REJECT" | "RETURN" | "SEEK_CLARIFICATION";
      comment?: string;
      clarifyUserId?: string; // target user for SEEK_CLARIFICATION
      clarifyDepartment?: string; // target department for SEEK_CLARIFICATION
      additionalCc?: string[]; // extra CC recipients added at APPROVE time
    };

    const validActions = ["RECOMMEND", "APPROVE", "REJECT", "RETURN", "SEEK_CLARIFICATION"];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    if ((action === "REJECT" || action === "RETURN") && !comment?.trim()) {
      return NextResponse.json(
        { error: "Comment is required when rejecting or returning a memo" },
        { status: 400 }
      );
    }

    if (action === "SEEK_CLARIFICATION" && !comment?.trim()) {
      return NextResponse.json(
        { error: "A question/comment is required when seeking clarification" },
        { status: 400 }
      );
    }

    if (action === "SEEK_CLARIFICATION" && !clarifyUserId && !clarifyDepartment) {
      return NextResponse.json(
        { error: "Select a user or department to seek clarification from" },
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

    // SEEK_CLARIFICATION doesn't complete the task — handle separately
    if (action === "SEEK_CLARIFICATION") {
      if (clarifyUserId) {
        // Verify the target user exists
        const targetUser = await db.user.findUnique({
          where: { id: clarifyUserId },
          select: { id: true, name: true, displayName: true },
        });
        if (!targetUser) {
          return NextResponse.json({ error: "Target user not found" }, { status: 404 });
        }

        // Create the clarification event (task stays PENDING)
        await db.workflowEvent.create({
          data: {
            instanceId: memo.id,
            eventType: "MEMO_CLARIFICATION_REQUESTED",
            actorId: userId,
            data: {
              actorName: session.user.name,
              stepName: currentTask.stepName,
              targetUserId: targetUser.id,
              targetUserName: targetUser.displayName || targetUser.name,
              question: comment!.trim(),
            },
          },
        });

        // Notify the target user
        await db.notification.create({
          data: {
            userId: targetUser.id,
            type: "MEMO_CLARIFICATION_REQUESTED",
            title: "Clarification Requested",
            body: `${session.user.name} is seeking clarification on memo "${memo.subject}": ${comment!.trim().slice(0, 100)}`,
            linkUrl: `/memos/${memo.id}`,
          },
        });

        await writeAudit({
          userId: session.user.id,
          action: "memo.seek_clarification",
          resourceType: "Memo",
          resourceId: memo.id,
          metadata: {
            targetUserId: targetUser.id,
            question: comment!.trim(),
          },
        });
      } else {
        // Department-wide clarification
        const users = await db.user.findMany({
          where: {
            department: clarifyDepartment,
            id: { not: session.user.id },
          },
          select: { id: true, name: true, displayName: true },
        });

        if (users.length === 0) {
          return NextResponse.json(
            { error: "No users found in that department" },
            { status: 404 }
          );
        }

        // Create a single clarification event for the department
        await db.workflowEvent.create({
          data: {
            instanceId: memo.id,
            eventType: "MEMO_CLARIFICATION_REQUESTED",
            actorId: userId,
            data: {
              actorName: session.user.name,
              stepName: currentTask.stepName,
              targetDepartment: clarifyDepartment,
              targetUserCount: users.length,
              question: comment!.trim(),
            },
          },
        });

        // Notify every user in the department
        await db.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            type: "MEMO_CLARIFICATION_REQUESTED",
            title: "Clarification Requested",
            body: `${session.user.name} is seeking clarification on memo "${memo.subject}": ${comment!.trim().slice(0, 100)}`,
            linkUrl: `/memos/${memo.id}`,
          })),
        });

        await writeAudit({
          userId: session.user.id,
          action: "memo.seek_clarification",
          resourceType: "Memo",
          resourceId: memo.id,
          metadata: {
            targetDepartment: clarifyDepartment,
            userCount: users.length,
            question: comment!.trim(),
          },
        });
      }

      return NextResponse.json({ success: true, action: "SEEK_CLARIFICATION" });
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

      // 1b. If this was the HOD Endorsement step and the HOD approved, reassign
      // the memo's identity so it now bears the HOD's name. Preserve the real
      // author via originalInitiatedById (keep the first-ever author if already set).
      if (currentTask.stepName === "HOD Endorsement" && taskAction === "APPROVED") {
        await tx.workflowInstance.update({
          where: { id: memo.id },
          data: {
            originalInitiatedById: memo.originalInitiatedById ?? memo.initiatedById,
            initiatedById: session.user.id,
          },
        });
        await tx.workflowEvent.create({
          data: {
            instanceId: memo.id,
            eventType: "MEMO_ENDORSED_BY_HOD",
            actorId: session.user.id,
            data: {
              previousInitiatedById: memo.initiatedById,
              newInitiatedById: session.user.id,
              hodName: session.user.name,
            },
          },
        });
      }

      // 2. Create workflow event
      const extraCcForEvent =
        action === "APPROVE" && Array.isArray(additionalCc)
          ? additionalCc.map((c) => (typeof c === "string" ? c.trim() : "")).filter(Boolean)
          : [];
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
            ...(extraCcForEvent.length > 0 ? { additionalCc: extraCcForEvent } : {}),
          },
        },
      });

      if (action === "RECOMMEND") {
        // Move to next step
        const nextTask = pendingTasks.find(
          (t) => t.stepIndex > currentTask.stepIndex
        );
        if (nextTask && nextTask.assigneeId) {
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
        // Final approval -- complete the workflow. If the approver added extra
        // CCs, merge them into the memo's formData.cc so they appear on the
        // final template.
        const existingCc = Array.isArray((formData as Record<string, unknown>)?.cc)
          ? ((formData as Record<string, unknown>).cc as string[])
          : [];
        const extraCc = (additionalCc ?? [])
          .map((c) => (typeof c === "string" ? c.trim() : ""))
          .filter(Boolean);
        const mergedCc = Array.from(new Set([...existingCc, ...extraCc]));

        await tx.workflowInstance.update({
          where: { id: memo.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            ...(extraCc.length > 0
              ? { formData: { ...(formData as Record<string, unknown>), cc: mergedCc } }
              : {}),
          },
        });

        // --- Option A: Archive the document on FINAL approval only ---
        // Guards:
        //   * taskAction === "APPROVED" (not RETURN / REJECT)
        //   * no remaining PENDING tasks on the workflow (i.e. this was truly
        //     the last step — so a mid-chain HOD Endorsement or Recommendation
        //     cannot trigger archival)
        //   * skip communicating memos — they are created already ARCHIVED, so
        //     we do not rewrite them here
        const memoTypeValue = (formData as Record<string, unknown>)?.memoType;
        const isCommunicatingMemo = memoTypeValue === "communicating";

        const remainingPending = await tx.workflowTask.count({
          where: {
            instanceId: memo.id,
            status: "PENDING",
          },
        });

        const shouldArchive =
          taskAction === "APPROVED" &&
          remainingPending === 0 &&
          !isCommunicatingMemo &&
          !!memo.documentId;

        if (shouldArchive && memo.documentId) {
          const docUpdate: Record<string, unknown> = { status: "ARCHIVED" };
          if (extraCc.length > 0) {
            const existingDoc = await tx.document.findUnique({
              where: { id: memo.documentId },
              select: { metadata: true },
            });
            const meta = (existingDoc?.metadata as Record<string, unknown>) ?? {};
            docUpdate.metadata = {
              ...meta,
              cc: mergedCc,
              copy_to: mergedCc.join(", "),
            };
          }
          await tx.document.update({
            where: { id: memo.documentId },
            data: docUpdate,
          });

          // Emit a workflow event for the audit trail
          await tx.workflowEvent.create({
            data: {
              instanceId: memo.id,
              eventType: "MEMO_ARCHIVED",
              actorId: userId,
              data: {
                documentId: memo.documentId,
                reason: "Final approval — filed into Internal Memo casefolder",
                actorName: session.user.name,
              },
            },
          });
        } else if (memo.documentId && extraCc.length > 0 && !isCommunicatingMemo) {
          // Not archiving (shouldn't happen at APPROVE but be defensive) —
          // still sync CCs into metadata so the final template renders them.
          const existingDoc = await tx.document.findUnique({
            where: { id: memo.documentId },
            select: { metadata: true },
          });
          const meta = (existingDoc?.metadata as Record<string, unknown>) ?? {};
          await tx.document.update({
            where: { id: memo.documentId },
            data: {
              metadata: {
                ...meta,
                cc: mergedCc,
                copy_to: mergedCc.join(", "),
              },
            },
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

    // Snapshot a new memo version so the action is captured as a
    // distinct PDF in the Versions panel (one row per state change).
    try {
      const { snapshotMemoVersion } = await import("@/lib/memo-versions");
      const verb =
        action === "APPROVE" ? "Approved"
        : action === "RECOMMEND" ? "Recommended"
        : action === "REJECT" ? "Rejected"
        : action === "RETURN" ? "Returned for revision"
        : action === "SEEK_CLARIFICATION" ? "Clarification requested"
        : "Updated";
      const note = comment?.trim()
        ? `${verb} at "${currentTask.stepName}" by ${session.user.name ?? "user"} — ${comment.trim()}`
        : `${verb} at "${currentTask.stepName}" by ${session.user.name ?? "user"}`;
      await snapshotMemoVersion(memo.id, note, session.user.id);
    } catch (err) {
      logger.error("Failed to record action memo version", err, { memoId: memo.id, action });
    }

    if (currentTask.stepName === "HOD Endorsement" && taskAction === "APPROVED") {
      await writeAudit({
        userId: session.user.id,
        action: "memo.endorsed_by_hod",
        resourceType: "Memo",
        resourceId: memo.id,
        metadata: {
          taskId: currentTask.id,
          previousInitiatedById: memo.initiatedById,
          newInitiatedById: session.user.id,
          hodName: session.user.name,
          memoReference: formData?.memoReference,
        },
      });
    }

    // Audit the archival if this APPROVE was truly the final step.
    // We re-check the same conditions here (outside the tx) so the audit row
    // only fires when the document was actually archived.
    if (action === "APPROVE" && memo.documentId) {
      const stillPending = await db.workflowTask.count({
        where: { instanceId: memo.id, status: "PENDING" },
      });
      const memoTypeValue = (formData as Record<string, unknown>)?.memoType;
      const isCommunicatingMemo = memoTypeValue === "communicating";
      if (stillPending === 0 && !isCommunicatingMemo) {
        await writeAudit({
          userId: session.user.id,
          action: "memo.archived",
          resourceType: "Document",
          resourceId: memo.documentId,
          metadata: {
            workflowInstanceId: memo.id,
            memoReference: formData?.memoReference,
            subject: memo.subject,
          },
        });
      }
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    logger.error("Failed to process memo action", error, {
      route: "/api/memos/[id]",
      method: "PATCH",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
