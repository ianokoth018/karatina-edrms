import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { advanceWorkflow, resolveAssignee } from "@/lib/workflow-engine";

// ---------------------------------------------------------------------------
// POST /api/correspondence/[id]/action
//
// This API is a THIN WRAPPER over the generic workflow engine.
//
// 1. It finds the linked workflow instance
// 2. Completes the current workflow task with the given action
// 3. Calls advanceWorkflow() to traverse the graph, evaluate decision
//    nodes, create next tasks, and resolve assignees — ALL from the
//    template definition stored in the database
// 4. Syncs the correspondence record status from the workflow state
//
// The workflow template (nodes, edges, conditions, SLA, role assignments)
// is defined in the database — no hardcoded step transitions here.
// ---------------------------------------------------------------------------

/** Map workflow instance status to correspondence status. */
function deriveCorrespondenceStatus(
  wfStatus: string,
  currentStepName: string
): string {
  if (wfStatus === "COMPLETED") return "CLOSED";
  if (wfStatus === "REJECTED") return "IN_PROGRESS"; // sent back for revision

  // Derive from the current step name
  const stepLower = currentStepName.toLowerCase();
  if (stepLower.includes("capture")) return "DRAFT";
  if (stepLower.includes("register")) return "RECEIVED";
  if (stepLower.includes("assign")) return "REGISTERED";
  if (stepLower.includes("review")) return "ASSIGNED";
  if (stepLower.includes("approval")) return "PENDING_APPROVAL";
  if (stepLower.includes("dispatch")) return "APPROVED";
  if (stepLower.includes("archive")) return "DISPATCHED";

  return "IN_PROGRESS";
}

export async function POST(
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
    const {
      action,
      comment,
      assignToUserId,
      department,
      responseData,
    } = body as {
      action: string;
      comment?: string;
      assignToUserId?: string;
      department?: string;
      responseData?: Record<string, unknown>;
    };

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    // ── 1. Load correspondence and its linked workflow instance ──────────

    const correspondence = await db.correspondence.findUnique({
      where: { id },
    });

    if (!correspondence) {
      return NextResponse.json({ error: "Correspondence not found" }, { status: 404 });
    }

    const meta = (correspondence.metadata ?? {}) as Record<string, unknown>;
    const workflowInstanceId = meta.workflowInstanceId as string | undefined;

    if (!workflowInstanceId) {
      return NextResponse.json(
        { error: "No workflow instance linked to this correspondence" },
        { status: 400 }
      );
    }

    // ── 2. Find the current pending task in the workflow ─────────────────

    const pendingTasks = await db.workflowTask.findMany({
      where: { instanceId: workflowInstanceId, status: "PENDING" },
      orderBy: { stepIndex: "asc" },
    });

    if (pendingTasks.length === 0) {
      return NextResponse.json(
        { error: "No pending tasks in this workflow" },
        { status: 400 }
      );
    }

    const currentTask = pendingTasks[0];

    // ── 3. Map the user action to a workflow action ──────────────────────

    // The workflow engine understands: APPROVED, REJECTED, RETURNED
    let wfAction: "APPROVED" | "REJECTED" | "RETURNED";

    switch (action) {
      case "SUBMIT":
      case "REGISTER":
      case "ASSIGN":
      case "APPROVE":
      case "DISPATCH":
      case "CLOSE":
        wfAction = "APPROVED"; // all forward-moving actions = approve the task
        break;
      case "REJECT":
        wfAction = "REJECTED";
        break;
      case "FORWARD":
      case "ADD_COMMENT":
        wfAction = "RETURNED"; // re-route = return to a previous step
        break;
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    // ── 4. Complete the current task ─────────────────────────────────────

    await db.workflowTask.update({
      where: { id: currentTask.id },
      data: {
        status: "COMPLETED",
        action: wfAction,
        comment: comment ?? null,
        completedAt: new Date(),
      },
    });

    // ── 5. Merge form data into the workflow instance ────────────────────

    const formData: Record<string, unknown> = {
      ...(responseData ?? {}),
      priority: correspondence.priority,
      department: department ?? correspondence.department,
      isConfidential: correspondence.isConfidential,
      type: correspondence.type,
      lastAction: action,
    };

    if (department) formData.department = department;
    if (assignToUserId) formData.assignedToUserId = assignToUserId;

    // ── 6. Call the workflow engine to advance ───────────────────────────

    const result = await advanceWorkflow({
      instanceId: workflowInstanceId,
      completedTaskId: currentTask.id,
      action: wfAction,
      actorId: session.user.id,
      comment,
      formData,
    });

    // ── 7. Sync correspondence status from workflow state ────────────────

    const wfInstance = await db.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
      include: {
        tasks: {
          where: { status: "PENDING" },
          orderBy: { stepIndex: "asc" },
          take: 1,
        },
      },
    });

    const nextPendingTask = wfInstance?.tasks[0];
    const nextStepName = nextPendingTask?.stepName ?? "ARCHIVE";
    const wfStatus = wfInstance?.status ?? "IN_PROGRESS";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corrUpdate: Record<string, any> = {
      currentStep: nextStepName.toUpperCase(),
      status: deriveCorrespondenceStatus(wfStatus, nextStepName),
      updatedAt: new Date(),
    };

    // SLA: check breach + set new deadline from workflow task
    if (correspondence.slaDeadline && new Date() > correspondence.slaDeadline) {
      corrUpdate.slaBreached = true;
    }
    if (nextPendingTask?.dueAt) {
      corrUpdate.slaDeadline = nextPendingTask.dueAt;
    }

    // Step-specific updates
    if (action === "ASSIGN" && assignToUserId) {
      corrUpdate.assignedToId = assignToUserId;
    }
    if (action === "ASSIGN" && department) {
      corrUpdate.department = department;
    }
    if (result.workflowCompleted) {
      corrUpdate.status = "CLOSED";
      corrUpdate.closedAt = new Date();
      corrUpdate.currentStep = "CLOSED";

      // Archive linked document
      if (correspondence.documentId) {
        await db.document.update({
          where: { id: correspondence.documentId },
          data: { status: "ARCHIVED" },
        }).catch(() => {});
      }
    }
    if (action === "DISPATCH" && responseData) {
      if (responseData.dispatchMethod) corrUpdate.dispatchMethod = responseData.dispatchMethod;
      if (responseData.trackingNumber) corrUpdate.trackingNumber = responseData.trackingNumber;
    }

    // Update correspondence
    const updated = await db.correspondence.update({
      where: { id },
      data: corrUpdate,
      include: {
        assignedTo: { select: { id: true, name: true, displayName: true, department: true } },
        createdBy: { select: { id: true, name: true, displayName: true } },
      },
    });

    // ── 8. Create correspondence action log ──────────────────────────────

    await db.correspondenceActionLog.create({
      data: {
        correspondenceId: id,
        action,
        fromStep: correspondence.currentStep,
        toStep: corrUpdate.currentStep ?? correspondence.currentStep,
        actorId: session.user.id,
        comment: comment ?? null,
      },
    });

    // ── 9. Audit log ─────────────────────────────────────────────────────

    await writeAudit({
      userId: session.user.id,
      action: `correspondence.${action.toLowerCase()}`,
      resourceType: "Correspondence",
      resourceId: id,
      metadata: {
        referenceNumber: correspondence.referenceNumber,
        fromStep: correspondence.currentStep,
        toStep: corrUpdate.currentStep,
        workflowInstanceId,
        workflowCompleted: result.workflowCompleted,
        nextTasks: result.nextTasks,
      },
    });

    logger.info("Correspondence action processed via workflow engine", {
      correspondenceId: id,
      action,
      fromStep: correspondence.currentStep,
      toStep: corrUpdate.currentStep,
      workflowCompleted: result.workflowCompleted,
    });

    return NextResponse.json({
      success: true,
      action,
      fromStep: correspondence.currentStep,
      toStep: corrUpdate.currentStep,
      status: updated.status,
      workflowCompleted: result.workflowCompleted,
      nextTasks: result.nextTasks,
    });
  } catch (error) {
    logger.error("Failed to process correspondence action", error, {
      route: "/api/correspondence/[id]/action",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
