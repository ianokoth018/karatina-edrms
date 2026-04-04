import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateReference } from "@/lib/reference";
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

    const userId = session.user.id;

    // Build where clause: memos the user initiated, is a recommender on, or is addressed to
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      document: { documentType: "MEMO" },
    };

    // User involvement filter -- user must be initiator, or have a task assigned
    where.OR = [
      { initiatedById: userId },
      { tasks: { some: { assigneeId: userId } } },
    ];

    // Tab filters
    switch (tab) {
      case "drafts":
        where.status = "PENDING";
        where.currentStepIndex = 0;
        where.initiatedById = userId;
        break;
      case "pending":
        where.tasks = {
          some: {
            assigneeId: userId,
            status: "PENDING",
          },
        };
        // Merge with existing OR
        delete where.OR;
        break;
      case "approved":
        where.status = "COMPLETED";
        break;
      case "rejected":
        where.status = "REJECTED";
        break;
      // "all" -- no extra filter
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

    const [memos, total] = await Promise.all([
      db.workflowInstance.findMany({
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
            take: 1,
          },
          document: {
            select: { id: true, referenceNumber: true, title: true, status: true },
          },
        },
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.workflowInstance.count({ where }),
    ]);

    // Enrich each memo with computed fields
    const enriched = memos.map((memo) => {
      const formData = memo.formData as Record<string, unknown>;
      const toUser = memo.tasks.find((t) => t.stepName === "Final Approval")?.assignee;
      const fromUser = memo.tasks.find((t) => t.stepName === "Self-Review")?.assignee;

      // Determine memo-specific status
      let memoStatus = "DRAFT";
      if (memo.status === "COMPLETED") {
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

      return {
        id: memo.id,
        referenceNumber: memo.referenceNumber,
        subject: memo.subject,
        status: memoStatus,
        workflowStatus: memo.status,
        from: fromUser ?? { id: "", name: "", displayName: formData?.fromName ?? "Unknown", department: "", jobTitle: "" },
        to: toUser ?? { id: "", name: "", displayName: formData?.toName ?? "Unknown", department: "", jobTitle: "" },
        body: formData?.body ?? "",
        startedAt: memo.startedAt,
        completedAt: memo.completedAt,
        currentStepIndex: memo.currentStepIndex,
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
      department: memoDepartment,
      departmentOffice,
      designation,
      referenceNumber: customRef,
    } = body as {
      to: string;
      toIsManual?: boolean;
      subject: string;
      memoBody: string;
      recommenders: string[];
      documentId?: string;
      approver?: string;
      cc?: string[];
      department?: string;
      departmentOffice?: string;
      designation?: string;
      referenceNumber?: string;
    };

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
    if (recommenders && recommenders.length > 5) {
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
      select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
    });
    if (!initiator) {
      return NextResponse.json({ error: "Initiator not found" }, { status: 404 });
    }

    const department = memoDepartment || session.user.department || "GEN";
    const deptAbbr = department.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "GEN";

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
    } else {
      memoReference = await generateReference("MEMO", deptAbbr);
    }

    // Get or create the Internal Memo Approval workflow template
    let template = await db.workflowTemplate.findFirst({
      where: { name: "Internal Memo Approval" },
    });
    if (!template) {
      template = await db.workflowTemplate.create({
        data: {
          name: "Internal Memo Approval",
          description: "Sequential approval workflow for internal university memoranda",
          createdById: session.user.id,
          definition: {
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
          status: "DRAFT",
          metadata: {
            formTemplateId: memoCasefolder?.id ?? null,
            memoType: "INTERNAL",
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
          status: "IN_PROGRESS",
          currentStepIndex: 1, // Skip self-review (auto-completed)
          formData: {
            body: memoBody.trim(),
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
          },
        },
      });

      // 4. Create WorkflowTasks
      const tasks = [];

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

      // Steps 1-N: Recommenders
      for (let i = 0; i < recommenderUsers.length; i++) {
        tasks.push(
          await tx.workflowTask.create({
            data: {
              instanceId: workflowInstance.id,
              stepName: `Recommendation ${i + 1}`,
              stepIndex: i + 1,
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
        const finalStepIndex = recommenderUsers.length + 1;
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

      // 5. Create initial workflow event
      await tx.workflowEvent.create({
        data: {
          instanceId: workflowInstance.id,
          eventType: "MEMO_CREATED",
          actorId: session.user.id,
          data: {
            memoReference,
            subject: subject.trim(),
            to: toDisplayName,
            recommenderCount: recommenderUsers.length,
          },
        },
      });

      // 6. Notify the first person in the chain
      const firstPendingUserId =
        recommenderUsers.length > 0
          ? recommenderUsers[0].id
          : finalApproverId;
      const firstPendingName =
        recommenderUsers.length > 0
          ? recommenderUsers[0].displayName
          : toDisplayName;

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

      return { workflowInstance, document, tasks };
    });

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
