import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateMemoReference, generatePersonalMemoReference } from "@/lib/reference";
import { getDepartmentMemoCode } from "@/lib/departments";
import { isSenderMoreSenior } from "@/lib/role-hierarchy";
import { findHodForDepartment, userIsHod } from "@/lib/hod";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/memos -- list memos the current user is involved in
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const tab = searchParams.get("tab") ?? "all"; // all | drafts | pending | approved | rejected
    const search = searchParams.get("search");
    const initiatedByMe = searchParams.get("initiatedByMe") === "true";
    // scope=involved forces the user-scoped filter even for elevated roles.
    // Used by surfaces like the dashboard that should only show memos the
    // current user has personally taken part in.
    const involvedOnly = searchParams.get("scope") === "involved";

    const userId = session.user.id;
    const userRoles = (session.user.roles as string[] | undefined) ?? [];

    // -------------------------------------------------------------------------
    // Elevated roles bypass the "only memos at your desk" access filter.
    // VC / DVC see institution-wide; Director / Dean / Registrar PA / Admin see
    // directorate-wide. Trace-My-Memos and scope=involved always narrow to the
    // current user.
    // -------------------------------------------------------------------------
    const INSTITUTION_ROLES = new Set(["VICE_CHANCELLOR", "DVC_PFA", "DVC_ARSA"]);
    const ELEVATED_ROLES = new Set(["ADMIN", "DIRECTOR", "DEAN", "REGISTRAR_PA"]);
    const hasElevatedAccess =
      !initiatedByMe &&
      !involvedOnly &&
      userRoles.some((r) => INSTITUTION_ROLES.has(r) || ELEVATED_ROLES.has(r));

    // -------------------------------------------------------------------------
    // Access rule (standard users): may see a memo only if they are:
    //   1. The initiator
    //   2. Have already acted (COMPLETED task)
    //   3. Are the current active assignee (lowest pending stepIndex)
    // -------------------------------------------------------------------------

    // Match both legacy "MEMO" and the current "Internal Memo" casefolder type
    // (memos filed via the Internal Memo casefolder are stored with that type).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { document: { documentType: { in: ["MEMO", "Internal Memo"] } } };

    if (!hasElevatedAccess) {
      where.OR = [
        { initiatedById: userId },
        { tasks: { some: { assigneeId: userId } } },
      ];
    }

    // Trace-My-Memos filter: narrow to memos this user initiated
    if (initiatedByMe) {
      where.initiatedById = userId;
      delete where.OR;
    }

    // Tab pre-filters (narrow the fetch before application-level access filter)
    switch (tab) {
      case "drafts":
        where.status = "IN_PROGRESS";
        where.currentStepIndex = 0;
        where.initiatedById = userId;
        delete where.OR;
        break;
      case "pending":
        // Only memos where this user has an active pending task
        where.tasks = { some: { assigneeId: userId, status: "PENDING" } };
        delete where.OR;
        break;
      case "approved":
        where.status = "COMPLETED";
        break;
      case "rejected":
        where.status = "REJECTED";
        break;
    }

    if (search) {
      where.AND = [
        {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { referenceNumber: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    // Fetch all matching memos (no DB-level pagination yet — we filter first)
    const allMemos = await db.workflowInstance.findMany({
      where,
      include: {
        tasks: {
          orderBy: { stepIndex: "asc" },
          include: {
            assignee: {
              select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
            },
          },
        },
        events: {
          orderBy: { occurredAt: "desc" },
        },
        document: {
          select: { id: true, referenceNumber: true, title: true, status: true },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    // Application-level access filter (skipped for elevated roles)
    const accessible = hasElevatedAccess
      ? allMemos
      : allMemos.filter((memo) => {
          if (memo.initiatedById === userId) return true;
          const tasks = memo.tasks;
          if (tasks.some((t) => t.assigneeId === userId && t.status === "COMPLETED")) return true;
          const pendingTasks = tasks.filter((t) => t.status === "PENDING");
          if (pendingTasks.length === 0) return false;
          const lowestPending = Math.min(...pendingTasks.map((t) => t.stepIndex));
          return pendingTasks.some((t) => t.assigneeId === userId && t.stepIndex === lowestPending);
        });

    const total = accessible.length;
    const memos = accessible.slice((page - 1) * limit, page * limit);

    // Enrich each memo with computed fields
    const enriched = memos.map((memo) => {
      const formData = memo.formData as Record<string, unknown>;
      const isCommunicating = formData?.memoType === "communicating";
      const toUser = memo.tasks.find((t) => t.stepName === "Final Approval")?.assignee;
      const fromUser = memo.tasks.find((t) =>
        t.stepName === "Self-Review" || t.stepName === "Sent"
      )?.assignee;

      // Determine memo-specific status
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
        // Check if returned
        const hasReturnEvent = memo.events.some(
          (e) => (e.data as Record<string, unknown>)?.action === "RETURNED"
        );
        if (hasReturnEvent && memo.currentStepIndex === 0) {
          memoStatus = "RETURNED";
        } else {
          // Check what step we're on
          const currentTask = memo.tasks.find(
            (t) => t.status === "PENDING"
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

      const pendingTasksList = memo.tasks.filter((t) => t.status === "PENDING");
      const lowestPendingIdx =
        pendingTasksList.length > 0
          ? Math.min(...pendingTasksList.map((t) => t.stepIndex))
          : null;
      let currentAssignee =
        lowestPendingIdx !== null
          ? (pendingTasksList.find((t) => t.stepIndex === lowestPendingIdx)?.assignee ?? null)
          : null;

      // If there's an outstanding clarification request, the memo is effectively
      // "with" the clarification target until they respond.
      const provided = new Set(
        memo.events
          .filter((e) => e.eventType === "MEMO_CLARIFICATION_PROVIDED")
          .map((e) => String((e.data as Record<string, unknown>)?.requestEventId ?? ""))
          .filter(Boolean)
      );
      const outstandingClarification = memo.events.find(
        (e) =>
          e.eventType === "MEMO_CLARIFICATION_REQUESTED" && !provided.has(e.id)
      );
      let awaitingClarification = false;
      if (outstandingClarification) {
        awaitingClarification = true;
        const d = outstandingClarification.data as Record<string, unknown>;
        if (d.targetUserId) {
          currentAssignee = {
            id: String(d.targetUserId),
            name: String(d.targetUserName ?? ""),
            displayName: String(d.targetUserName ?? ""),
            department: null,
            jobTitle: "Clarification requested",
          };
        } else if (d.targetDepartment) {
          currentAssignee = {
            id: `dept:${d.targetDepartment}`,
            name: String(d.targetDepartment),
            displayName: `${d.targetDepartment} dept.`,
            department: String(d.targetDepartment),
            jobTitle: "Clarification requested",
          };
        }
      }

      return {
        id: memo.id,
        referenceNumber: memo.referenceNumber,
        memoReferenceNumber: memo.document?.referenceNumber ?? null,
        subject: memo.subject,
        status: memoStatus,
        memoType: isCommunicating ? "communicating" : "administrative",
        workflowStatus: memo.status,
        from: fromUser ?? { id: "", name: "", displayName: formData?.fromName ?? "Unknown", department: "", jobTitle: "" },
        to: toUser ?? { id: "", name: "", displayName: formData?.toName ?? "Unknown", department: "", jobTitle: "" },
        body: formData?.body ?? "",
        startedAt: memo.startedAt,
        completedAt: memo.completedAt,
        currentStepIndex: memo.currentStepIndex,
        currentAssignee,
        awaitingClarification,
        trail: memo.tasks.map((t) => ({
          id: t.id,
          stepName: t.stepName,
          stepIndex: t.stepIndex,
          status: t.status,
          action: t.action,
          comment: t.comment,
          assignee: t.assignee,
          assignedAt: t.assignedAt,
          completedAt: t.completedAt,
        })),
        tasks: memo.tasks,
        documentId: memo.documentId,
        initiatedById: memo.initiatedById,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      memos: enriched,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error("Failed to list memos", error, {
      route: "/api/memos",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/memos -- create a new internal memo
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      to,
      toIsManual,
      subject,
      memoBody,
      recommenders,
      documentId,
      approver: approverId,
      cc,
      bcc,
      department: memoDepartment,
      departmentOffice,
      designation,
      referenceNumber: customRef,
      memoType: memoTypeRaw,
      memoCategory: memoCategoryRaw,
      forwardToHod: forwardToHodRaw,
      draftId: incomingDraftId,
      signatureMethod: incomingSignatureMethod,
      initialPdfBase64,
    } = body as {
      to: string;
      toIsManual?: boolean;
      subject: string;
      memoBody: string;
      recommenders: string[];
      documentId?: string;
      approver?: string;
      cc?: string[];
      bcc?: string[];
      department?: string;
      departmentOffice?: string;
      designation?: string;
      referenceNumber?: string;
      memoType?: "administrative" | "communicating";
      memoCategory?: "personal" | "departmental";
      forwardToHod?: boolean;
      /** Draft id whose pre-signed DocuSign PDF should be attached as the
       *  memo's primary file (initiator chose Digital signature on Step 2). */
      draftId?: string;
      /** "electronic" or "digital" — chosen on Step 2. Persisted so the
       *  memo view can hide the "Sign with DocuSign" prompt when the
       *  initiator already signed electronically. */
      signatureMethod?: "electronic" | "digital";
      /** Captured React MemoDocument bytes (base64 PDF). When present,
       *  used as v1 so the memo view's Preview/Download Memo serves
       *  the exact template the initiator approved at submission. */
      initialPdfBase64?: string;
    };

    const memoType = memoTypeRaw ?? "administrative";
    const memoCategory = memoCategoryRaw ?? "departmental";
    const forwardToHodRequested = !!forwardToHodRaw;

    // Validate required fields
    if (!to?.trim()) {
      return NextResponse.json({ error: "Recipient (To) is required" }, { status: 400 });
    }
    if (!subject?.trim()) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!memoBody?.trim()) {
      return NextResponse.json({ error: "Memo body is required" }, { status: 400 });
    }
    if (memoType === "administrative" && recommenders && recommenders.length > 5) {
      return NextResponse.json({ error: "Maximum 5 recommenders allowed" }, { status: 400 });
    }

    // Resolve the recipient -- either a user ID or a free-text string
    let recipient: {
      id: string;
      name: string;
      displayName: string;
      department: string | null;
      jobTitle: string | null;
    } | null = null;
    let manualToText: string | null = null;

    if (toIsManual) {
      // Free-text "To" (e.g., "Current Students (2025/2026 AY)")
      manualToText = to.trim();
    } else {
      // User search -- verify the recipient exists
      recipient = await db.user.findUnique({
        where: { id: to },
        select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
      });
      if (!recipient) {
        return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
      }
    }

    // Verify separate approver if provided
    if (approverId && (!recipient || approverId !== recipient.id)) {
      const approverUser = await db.user.findUnique({
        where: { id: approverId },
        select: { id: true },
      });
      if (!approverUser) {
        return NextResponse.json({ error: "Approver not found" }, { status: 404 });
      }
    }

    // Verify recommenders exist
    let recommenderUsers: { id: string; name: string; displayName: string; department: string | null; jobTitle: string | null }[] = [];
    if (recommenders?.length) {
      recommenderUsers = await db.user.findMany({
        where: { id: { in: recommenders } },
        select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
      });
      if (recommenderUsers.length !== recommenders.length) {
        return NextResponse.json({ error: "One or more recommenders not found" }, { status: 404 });
      }
      // Preserve order
      recommenderUsers = recommenders.map(
        (rId) => recommenderUsers.find((u) => u.id === rId)!
      );
    }

    // Fetch initiator details
    const initiator = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true, name: true, displayName: true, department: true, jobTitle: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!initiator) {
      return NextResponse.json({ error: "Initiator not found" }, { status: 404 });
    }

    // Determine seniority for FROM/TO ordering
    let recipientRoles: string[] = [];
    if (recipient) {
      const recipientWithRoles = await db.user.findUnique({
        where: { id: recipient.id },
        select: { roles: { select: { role: { select: { name: true } } } } },
      });
      recipientRoles = recipientWithRoles?.roles.map((r) => r.role.name) ?? [];
    }
    const senderRoles = initiator.roles.map((r) => r.role.name);
    const senderIsSuperior = manualToText
      ? true // Manual "To" (e.g., "All Students") — sender is always superior
      : isSenderMoreSenior(senderRoles, recipientRoles);

    // Resolve HOD-forwarding context.  We only apply it to approval memos that
    // are departmental, whose author is not themselves an HOD, and where the
    // caller explicitly opted in by setting `forwardToHod: true`.  The HOD is
    // looked up by the initiator's own department (not the memo department
    // field, which may be overridden) so endorsement stays tied to the author.
    const shouldForwardToHod =
      forwardToHodRequested &&
      memoType === "administrative" &&
      memoCategory === "departmental" &&
      !userIsHod(senderRoles);

    const hod = shouldForwardToHod
      ? await findHodForDepartment(initiator.department)
      : null;

    // Guard against forwarding the memo to the author themselves.
    const applyHodStep = !!hod && hod.id !== initiator.id;

    const department = memoDepartment || session.user.department || "GEN";
    const deptMemoCode = getDepartmentMemoCode(department);
    const pfNumber = session.user.employeeId || "0000";

    // Use custom reference number or auto-generate
    let memoReference: string;
    if (customRef?.trim()) {
      // Verify uniqueness
      const existing = await db.document.findFirst({
        where: { referenceNumber: customRef.trim() },
      });
      if (existing) {
        return NextResponse.json({ error: "Reference number already exists" }, { status: 409 });
      }
      memoReference = customRef.trim();
    } else if (memoCategory === "personal") {
      memoReference = await generatePersonalMemoReference(pfNumber);
    } else {
      memoReference = await generateMemoReference(deptMemoCode);
    }

    // Get or create the workflow template based on memo type
    const templateName =
      memoType === "communicating"
        ? "Communicating Memo"
        : "Internal Memo Approval";

    let template = await db.workflowTemplate.findFirst({
      where: { name: templateName },
    });
    if (!template) {
      template = await db.workflowTemplate.create({
        data: {
          name: templateName,
          description:
            memoType === "communicating"
              ? "Direct memo circulation without approval chain"
              : "Sequential approval workflow for internal university memoranda",
          createdById: session.user.id,
          definition:
            memoType === "communicating"
              ? { type: "MEMO_COMMUNICATING", steps: ["Sent"] }
              : {
                  type: "MEMO_APPROVAL",
                  steps: ["Self-Review", "Recommendation(s)", "Final Approval"],
                },
          isActive: true,
        },
      });
    }

    // Resolve display names for the "To" field
    const toDisplayName = manualToText ?? (recipient?.displayName || to);

    // Create everything in a transaction
    const result = await db.$transaction(async (tx) => {
      // 0. Find the Internal Memo casefolder template (if it exists)
      const memoCasefolder = await tx.formTemplate.findFirst({
        where: { name: "Internal Memo", isActive: true },
        select: { id: true },
      });

      // 1. Create the Document record (type: MEMO)
      const document = await tx.document.create({
        data: {
          referenceNumber: memoReference,
          title: subject.trim(),
          description: memoBody.trim().slice(0, 500),
          documentType: memoCasefolder ? "Internal Memo" : "MEMO",
          department,
          createdById: session.user.id,
          status: memoType === "communicating" ? "ARCHIVED" : "DRAFT",
          metadata: {
            formTemplateId: memoCasefolder?.id ?? null,
            memoType: memoType === "communicating" ? "COMMUNICATING" : "INTERNAL",
            to: toDisplayName,
            toId: recipient?.id ?? null,
            toIsManual: !!manualToText,
            from: initiator.displayName,
            fromId: initiator.id,
            department,
            departmentOffice: departmentOffice ?? "",
            designation: designation ?? "",
            // Casefolder field values (for casefolder view)
            department_office: departmentOffice ?? "",
            from_name: initiator.displayName,
            designation_value: designation ?? "",
            phone: "+254 0716135171/0723683150",
            po_box: "P.O Box 1957-10101,KARATINA",
            to_name: toDisplayName,
            reference_number: memoReference,
            subject: subject.trim(),
            memo_body: memoBody.trim(),
            copy_to: (cc ?? []).join(", "),
            recommenders: recommenderUsers.map((r) => ({
              id: r.id,
              name: r.displayName,
              department: r.department,
              jobTitle: r.jobTitle,
            })),
            cc: cc ?? [],
            bcc: bcc ?? [],
            bodyHtml: memoBody.trim(),
          },
          ...(documentId
            ? {} // If linking to existing document, we don't create a file
            : {}),
        },
      });

      // 2. Generate workflow reference
      const workflowCount = await tx.workflowInstance.count({
        where: {
          referenceNumber: {
            startsWith: `WF-${new Date().getFullYear()}-`,
          },
        },
      });
      const wfSequence = (workflowCount + 1).toString().padStart(6, "0");
      const wfReference = `WF-${new Date().getFullYear()}-${wfSequence}`;

      // 3. Create the WorkflowInstance
      const workflowInstance = await tx.workflowInstance.create({
        data: {
          referenceNumber: wfReference,
          templateId: template.id,
          documentId: document.id,
          initiatedById: session.user.id,
          subject: subject.trim(),
          status: memoType === "communicating" ? "COMPLETED" : "IN_PROGRESS",
          currentStepIndex: memoType === "communicating" ? 0 : 1,
          completedAt: memoType === "communicating" ? new Date() : undefined,
          signatureMethod: incomingSignatureMethod ?? "electronic",
          formData: {
            body: memoBody.trim(),
            memoType,
            memoCategory,
            senderIsSuperior,
            toId: recipient?.id ?? null,
            toName: toDisplayName,
            toIsManual: !!manualToText,
            toDepartment: recipient?.department ?? null,
            toJobTitle: recipient?.jobTitle ?? null,
            fromId: initiator.id,
            fromName: initiator.displayName,
            fromDepartment: initiator.department,
            fromJobTitle: initiator.jobTitle,
            department,
            departmentOffice: departmentOffice ?? "",
            designation: designation ?? "",
            memoReference,
            documentId: document.id,
            cc: cc ?? [],
            bcc: bcc ?? [],
            forwardToHod: applyHodStep,
            hodId: applyHodStep ? hod!.id : null,
            hodName: applyHodStep ? hod!.displayName : null,
            hodDepartment: applyHodStep ? hod!.department : null,
          },
        },
      });

      // 4. Create WorkflowTasks
      const tasks = [];

      if (memoType === "communicating") {
        // Communicating memo: single auto-completed "Sent" step
        tasks.push(
          await tx.workflowTask.create({
            data: {
              instanceId: workflowInstance.id,
              stepName: "Sent",
              stepIndex: 0,
              assigneeId: session.user.id,
              status: "COMPLETED",
              action: "APPROVED",
              comment: "Communicating memo sent",
              completedAt: new Date(),
            },
          })
        );
      } else {
        // Approval memo: Self-Review → [HOD Endorsement?] → Recommenders → Final Approval
        // Step 0: Self-Review (auto-completed)
        tasks.push(
          await tx.workflowTask.create({
            data: {
              instanceId: workflowInstance.id,
              stepName: "Self-Review",
              stepIndex: 0,
              assigneeId: session.user.id,
              status: "COMPLETED",
              action: "APPROVED",
              comment: "Memo sent by initiator",
              completedAt: new Date(),
            },
          })
        );

        // Optional HOD endorsement step (inserted when creator opted in)
        const hodStepOffset = applyHodStep ? 1 : 0;
        if (applyHodStep && hod) {
          tasks.push(
            await tx.workflowTask.create({
              data: {
                instanceId: workflowInstance.id,
                stepName: "HOD Endorsement",
                stepIndex: 1,
                assigneeId: hod.id,
                status: "PENDING",
              },
            })
          );
        }

        // Recommenders
        for (let i = 0; i < recommenderUsers.length; i++) {
          tasks.push(
            await tx.workflowTask.create({
              data: {
                instanceId: workflowInstance.id,
                stepName: `Recommendation ${i + 1}`,
                stepIndex: 1 + hodStepOffset + i,
                assigneeId: recommenderUsers[i].id,
                status: "PENDING",
              },
            })
          );
        }

        // Final Step: Approver (can be the "To" person or a separate approver)
        // For manual "To", an explicit approver must be provided
        const finalApproverId = approverId || recipient?.id;
        if (finalApproverId) {
          const finalStepIndex = 1 + hodStepOffset + recommenderUsers.length;
          tasks.push(
            await tx.workflowTask.create({
              data: {
                instanceId: workflowInstance.id,
                stepName: "Final Approval",
                stepIndex: finalStepIndex,
                assigneeId: finalApproverId,
                status: "PENDING",
              },
            })
          );
        }
      }

      // 5. Create initial workflow event
      await tx.workflowEvent.create({
        data: {
          instanceId: workflowInstance.id,
          eventType: memoType === "communicating" ? "MEMO_SENT" : "MEMO_CREATED",
          actorId: session.user.id,
          data: {
            memoReference,
            memoType,
            subject: subject.trim(),
            to: toDisplayName,
            recommenderCount: recommenderUsers.length,
          },
        },
      });

      // 6. Notify recipients
      if (memoType === "communicating") {
        // Notify the "To" person and CC recipients that a memo was shared
        const notifyIds = [
          ...(recipient ? [recipient.id] : []),
          ...(cc ?? []),
          ...(bcc ?? []),
        ].filter((id) => id !== session.user.id);

        for (const userId of notifyIds) {
          await tx.notification.create({
            data: {
              userId,
              type: "MEMO_RECEIVED",
              title: "New Memo",
              body: `${initiator.displayName} has sent you a memo: "${subject.trim()}"`,
              linkUrl: `/memos/${workflowInstance.id}`,
            },
          });
        }
      } else {
        // Approval memo: notify first person in the chain
        const finalApproverId = approverId || recipient?.id;

        if (applyHodStep && hod) {
          await tx.notification.create({
            data: {
              userId: hod.id,
              type: "MEMO_ACTION_REQUIRED",
              title: "Memo Awaits Your Endorsement",
              body: `${initiator.displayName} has drafted a memo "${subject.trim()}" and requested your endorsement as HOD before it proceeds.`,
              linkUrl: `/memos/${workflowInstance.id}`,
            },
          });
        } else {
          const firstPendingUserId =
            recommenderUsers.length > 0
              ? recommenderUsers[0].id
              : finalApproverId;

          if (firstPendingUserId) {
            await tx.notification.create({
              data: {
                userId: firstPendingUserId,
                type: "MEMO_ACTION_REQUIRED",
                title: "New Memo Requires Your Action",
                body: `${initiator.displayName} has sent a memo "${subject.trim()}" that requires your ${
                  recommenderUsers.length > 0 && firstPendingUserId !== (recipient?.id ?? "")
                    ? "recommendation"
                    : "approval"
                }.`,
                linkUrl: `/memos/${workflowInstance.id}`,
              },
            });
          }
        }
      }

      return { workflowInstance, document, tasks };
    });

    // ---- v1 snapshot — every memo gets an initial PDF version, so
    // Preview/Download Memo always has *something* to serve and the
    // Versions panel starts non-empty. Prefer the client-captured
    // MemoDocument bytes (byte-identical to what the user previewed)
    // and fall back to the server-side render only if not provided.
    // The "[sig]" marker tells the version endpoint this snapshot
    // already loaded the signature so it doesn't trigger a refresh.
    try {
      if (incomingSignatureMethod === "electronic" && initialPdfBase64) {
        const { recordMemoVersion } = await import("@/lib/memo-versions");
        const pdfBytes = Uint8Array.from(Buffer.from(initialPdfBase64, "base64"));
        await recordMemoVersion({
          documentId: result.document.id,
          pdfBytes,
          changeNote: "[sig] Initial submission (rendered from preview)",
          createdById: session.user.id,
        });
      } else {
        const { snapshotMemoVersion } = await import("@/lib/memo-versions");
        await snapshotMemoVersion(
          result.workflowInstance.id,
          "[sig] Initial submission",
          session.user.id,
        );
      }
    } catch (err) {
      logger.error("Failed to record v1 memo version", err, {
        memoId: result.workflowInstance.id,
      });
    }

    // If the initiator pre-signed this memo with DocuSign in the
    // composer, attach the signed PDF (combined with cert of completion)
    // as the document's primary file and stamp the workflow instance so
    // the memo view shows the green "Digitally signed" pill on first load.
    if (incomingDraftId) {
      try {
        const draft = await db.memoDraft.findUnique({
          where: { id: incomingDraftId },
          select: {
            userId: true,
            signedPdfPath: true,
            docusignEnvelopeId: true,
            docusignSignedAt: true,
          },
        });
        if (
          draft &&
          draft.userId === session.user.id &&
          draft.signedPdfPath
        ) {
          const path = await import("path");
          const fs = await import("fs/promises");
          const srcAbs = path.resolve(process.cwd(), draft.signedPdfPath);
          const destDir = path.join(
            process.cwd(),
            "uploads",
            "memos",
            result.document.id,
          );
          await fs.mkdir(destDir, { recursive: true });
          const fileName = `${memoReference.replace(/[^A-Za-z0-9._-]/g, "_")}.signed.pdf`;
          const destAbs = path.join(destDir, fileName);
          const buf = await fs.readFile(srcAbs);
          await fs.writeFile(destAbs, buf);
          const relPath = path.posix.join(
            "uploads",
            "memos",
            result.document.id,
            fileName,
          );

          await db.documentFile.create({
            data: {
              documentId: result.document.id,
              storagePath: relPath,
              fileName,
              mimeType: "application/pdf",
              sizeBytes: BigInt(buf.length),
            },
          });

          // Record the signed PDF as the latest memo version too.
          try {
            const { recordMemoVersion } = await import("@/lib/memo-versions");
            await recordMemoVersion({
              documentId: result.document.id,
              pdfBytes: new Uint8Array(buf),
              changeNote: "Digitally signed with DocuSign at submission",
              createdById: session.user.id,
              fileName: `${memoReference.replace(/[^A-Za-z0-9._-]/g, "_")}.v-signed.pdf`,
            });
          } catch (err) {
            logger.error("Failed to record signed v-N memo version", err, {
              memoId: result.workflowInstance.id,
            });
          }

          await db.workflowInstance.update({
            where: { id: result.workflowInstance.id },
            data: {
              docusignEnvelopeId: draft.docusignEnvelopeId,
              docusignStatus: "completed",
              docusignSignedAt: draft.docusignSignedAt ?? new Date(),
              docusignSignedPdf: relPath,
            },
          });
        }
      } catch (err) {
        // Don't fail the memo creation if the PDF copy hiccups — log
        // and let the user re-attach if needed.
        logger.error("Failed to attach pre-signed DocuSign PDF to memo", err, {
          route: "/api/memos",
          method: "POST",
          draftId: incomingDraftId,
        });
      }
    }

    // Audit log
    await writeAudit({
      userId: session.user.id,
      action: "memo.created",
      resourceType: "Memo",
      resourceId: result.workflowInstance.id,
      metadata: {
        memoReference,
        subject: subject.trim(),
        to: toDisplayName,
        recommenderCount: recommenderUsers.length,
      },
    });

    logger.info("Memo created", {
      userId: session.user.id,
      action: "memo.created",
      route: "/api/memos",
      method: "POST",
    });

    return NextResponse.json(
      {
        id: result.workflowInstance.id,
        referenceNumber: memoReference,
        workflowReference: result.workflowInstance.referenceNumber,
        documentId: result.document.id,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Failed to create memo", error, {
      route: "/api/memos",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
