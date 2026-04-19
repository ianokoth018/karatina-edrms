import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/correspondence -- list correspondence with filters
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
    const type = searchParams.get("type"); // INCOMING or OUTGOING
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (type && (type === "INCOMING" || type === "OUTGOING")) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { fromEntity: { contains: search, mode: "insensitive" } },
        { toEntity: { contains: search, mode: "insensitive" } },
        { trackingNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    if (dateFrom || dateTo) {
      // Filter on dateReceived for INCOMING or dateSent for OUTGOING, or both
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);

      if (type === "INCOMING") {
        where.dateReceived = dateFilter;
      } else if (type === "OUTGOING") {
        where.dateSent = dateFilter;
      } else {
        // If no type filter, apply to createdAt as fallback
        where.createdAt = dateFilter;
      }
    }

    const [items, total] = await Promise.all([
      db.correspondence.findMany({
        where,
        include: {
          assignedTo: {
            select: { id: true, name: true, displayName: true, department: true },
          },
          createdBy: {
            select: { id: true, name: true, displayName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.correspondence.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error("Failed to list correspondence", error, {
      route: "/api/correspondence",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/correspondence -- register new correspondence
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      type,
      subject,
      fromEntity,
      toEntity,
      dateReceived,
      dateSent,
      dueDate,
      priority,
      description,
      dispatchMethod,
      trackingNumber,
      documentId,
      assignedToId,
    } = body as {
      type: string;
      subject: string;
      fromEntity: string;
      toEntity: string;
      dateReceived?: string;
      dateSent?: string;
      dueDate?: string;
      priority?: string;
      description?: string;
      dispatchMethod?: string;
      trackingNumber?: string;
      documentId?: string;
      assignedToId?: string;
    };

    // Validate required fields
    if (!type || (type !== "INCOMING" && type !== "OUTGOING")) {
      return NextResponse.json(
        { error: "Type must be INCOMING or OUTGOING" },
        { status: 400 }
      );
    }
    if (!subject?.trim()) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!fromEntity?.trim()) {
      return NextResponse.json({ error: "From entity is required" }, { status: 400 });
    }
    if (!toEntity?.trim()) {
      return NextResponse.json({ error: "To entity is required" }, { status: 400 });
    }

    // Validate optional relations
    if (assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: assignedToId } });
      if (!assignee) {
        return NextResponse.json({ error: "Assigned user not found" }, { status: 404 });
      }
    }

    if (documentId) {
      const doc = await db.document.findUnique({ where: { id: documentId } });
      if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    // Auto-generate reference number: CORR/IN/{year}/{seq} or CORR/OUT/{year}/{seq}
    const year = new Date().getFullYear();
    const prefix = type === "INCOMING" ? "CORR/IN" : "CORR/OUT";
    const pattern = `${prefix}/${year}/`;

    const lastCorrespondence = await db.correspondence.findFirst({
      where: {
        referenceNumber: { startsWith: pattern },
      },
      orderBy: { referenceNumber: "desc" },
      select: { referenceNumber: true },
    });

    let sequence = 1;
    if (lastCorrespondence) {
      const parts = lastCorrespondence.referenceNumber.split("/");
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    const referenceNumber = `${pattern}${sequence.toString().padStart(4, "0")}`;

    // SLA deadline: 3 days from now for initial capture
    const slaDeadline = new Date();
    slaDeadline.setDate(slaDeadline.getDate() + 3);

    // Determine department-based role assignment
    const dept = (body as Record<string, unknown>).department as string | undefined;
    const channel = (body as Record<string, unknown>).channel as string | undefined;
    const isConfidential = (body as Record<string, unknown>).isConfidential as boolean | undefined;

    // ── Case-based process: Link to Casefolder + Workflow ──────────────────

    // 1. Find or create the Correspondence Management casefolder template
    let casefolderTemplate = await db.formTemplate.findFirst({
      where: { name: "Correspondence Management", isActive: true },
      select: { id: true },
    });
    if (!casefolderTemplate) {
      casefolderTemplate = await db.formTemplate.create({
        data: {
          name: "Correspondence Management",
          description: "Case-based correspondence tracking — incoming & outgoing mail lifecycle",
          fields: [
            { name: "reference_number", label: "Reference Number", type: "text", required: true },
            { name: "corr_type", label: "Type", type: "select", options: ["INCOMING", "OUTGOING"], required: true },
            { name: "subject", label: "Subject", type: "text", required: true },
            { name: "from_entity", label: "From", type: "text", required: true },
            { name: "to_entity", label: "To", type: "text", required: true },
            { name: "channel", label: "Channel", type: "select", options: ["LETTER", "EMAIL", "SCAN", "SYSTEM_UPLOAD"] },
            { name: "priority", label: "Priority", type: "select", options: ["LOW", "NORMAL", "HIGH", "URGENT"] },
            { name: "department", label: "Department", type: "text" },
            { name: "description", label: "Description", type: "textarea" },
            { name: "dispatch_method", label: "Dispatch Method", type: "select", options: ["POST", "COURIER", "EMAIL", "HAND_DELIVERY"] },
            { name: "tracking_number", label: "Tracking Number", type: "text" },
            { name: "due_date", label: "Due Date", type: "date" },
            { name: "is_confidential", label: "Confidential", type: "checkbox" },
          ],
          createdById: session.user.id,
          isActive: true,
        },
      });
    }

    // 2. Create a Document record for the correspondence (EDRMS record)
    let docId = documentId || null;
    if (!docId) {
      const doc = await db.document.create({
        data: {
          referenceNumber,
          title: subject.trim(),
          description: (description?.trim() || "").slice(0, 500),
          documentType: "Correspondence Management",
          department: dept || session.user.department || "Registry (Records)",
          createdById: session.user.id,
          status: "ACTIVE",
          metadata: {
            formTemplateId: casefolderTemplate.id,
            corrType: type,
            fromEntity: fromEntity.trim(),
            toEntity: toEntity.trim(),
            channel: channel || null,
            priority: priority ?? "NORMAL",
            reference_number: referenceNumber,
            subject: subject.trim(),
            from_entity: fromEntity.trim(),
            to_entity: toEntity.trim(),
            corr_type: type,
            description: description?.trim() || "",
            dispatch_method: dispatchMethod || "",
            tracking_number: trackingNumber?.trim() || "",
            due_date: dueDate || "",
            is_confidential: isConfidential ?? false,
            department: dept || "",
          },
        },
      });
      docId = doc.id;
    }

    // 3. Find or create CORRESPONDENCE_MGMT workflow template
    let wfTemplate = await db.workflowTemplate.findFirst({
      where: { name: "Correspondence Management" },
    });
    if (!wfTemplate) {
      wfTemplate = await db.workflowTemplate.create({
        data: {
          name: "Correspondence Management",
          description: "Case-based workflow for incoming & outgoing correspondence lifecycle",
          createdById: session.user.id,
          definition: {
            type: "CORRESPONDENCE_MGMT",
            steps: ["CAPTURE", "REGISTER", "ASSIGN", "REVIEW", "APPROVAL_MGR", "APPROVAL_DIR", "DISPATCH", "ARCHIVE"],
          },
          isActive: true,
        },
      });
    }

    // 4. Create workflow instance tied to the document
    const wfCount = await db.workflowInstance.count({
      where: { referenceNumber: { startsWith: `WF-${new Date().getFullYear()}-` } },
    });
    const wfRef = `WF-${new Date().getFullYear()}-${(wfCount + 1).toString().padStart(6, "0")}`;

    const workflowInstance = await db.workflowInstance.create({
      data: {
        referenceNumber: wfRef,
        templateId: wfTemplate.id,
        documentId: docId,
        initiatedById: session.user.id,
        subject: subject.trim(),
        status: "IN_PROGRESS",
        currentStepIndex: 0,
        formData: {
          corrType: type,
          referenceNumber,
          subject: subject.trim(),
          fromEntity: fromEntity.trim(),
          toEntity: toEntity.trim(),
          channel: channel || null,
          priority: priority ?? "NORMAL",
          department: dept || null,
          casefolderTemplateId: casefolderTemplate.id,
        },
      },
    });

    // 5. Create initial workflow task (CAPTURE step — auto-completed)
    await db.workflowTask.create({
      data: {
        instanceId: workflowInstance.id,
        stepName: "CAPTURE",
        stepIndex: 0,
        assigneeId: session.user.id,
        status: "COMPLETED",
        action: "APPROVED",
        comment: `${type} correspondence captured`,
        completedAt: new Date(),
      },
    });

    // ── Create the Correspondence record ──────────────────────────────────

    const correspondence = await db.correspondence.create({
      data: {
        type,
        referenceNumber,
        subject: subject.trim(),
        fromEntity: fromEntity.trim(),
        toEntity: toEntity.trim(),
        dateReceived: dateReceived ? new Date(dateReceived) : null,
        dateSent: dateSent ? new Date(dateSent) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: priority ?? "NORMAL",
        description: description?.trim() || null,
        dispatchMethod: dispatchMethod || null,
        trackingNumber: trackingNumber?.trim() || null,
        channel: channel || null,
        isConfidential: isConfidential ?? false,
        department: dept || null,
        documentId: docId,
        assignedToId: assignedToId || null,
        assignedRole: "REGISTRY_CLERK",
        createdById: session.user.id,
        currentStep: "CAPTURE",
        status: "DRAFT",
        slaDeadline,
        metadata: {
          workflowInstanceId: workflowInstance.id,
          workflowReference: wfRef,
          casefolderTemplateId: casefolderTemplate.id,
          documentId: docId,
        },
      },
      include: {
        assignedTo: {
          select: { id: true, name: true, displayName: true, department: true },
        },
        createdBy: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    // Create initial action log entry
    await db.correspondenceActionLog.create({
      data: {
        correspondenceId: correspondence.id,
        action: "CREATED",
        fromStep: "CAPTURE",
        toStep: "CAPTURE",
        actorId: session.user.id,
        comment: `${type} correspondence registered: ${subject.trim()}`,
      },
    });

    // Audit log
    await writeAudit({
      userId: session.user.id,
      action: "correspondence.created",
      resourceType: "Correspondence",
      resourceId: correspondence.id,
      metadata: {
        referenceNumber,
        type,
        subject: subject.trim(),
      },
    });

    logger.info("Correspondence created", {
      userId: session.user.id,
      action: "correspondence.created",
      route: "/api/correspondence",
      method: "POST",
    });

    return NextResponse.json(correspondence, { status: 201 });
  } catch (error) {
    logger.error("Failed to create correspondence", error, {
      route: "/api/correspondence",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
