import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/correspondence/[id] -- fetch single correspondence detail
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

    const correspondence = await db.correspondence.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
        },
        createdBy: {
          select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
        },
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
        actionLogs: {
          orderBy: { occurredAt: "desc" },
          include: {
            // Prisma doesn't have a direct relation for actorId, so we fetch separately below
          },
        },
      },
    });

    if (!correspondence) {
      return NextResponse.json({ error: "Correspondence not found" }, { status: 404 });
    }

    // Enrich actionLogs with actor info (actorId is a plain string, not a Prisma relation)
    let enrichedLogs: Array<Record<string, unknown>> = [];
    if (correspondence.actionLogs.length) {
      const actorIds = [...new Set(correspondence.actionLogs.map((l) => l.actorId))];
      const actors = await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, displayName: true, department: true, jobTitle: true },
      });
      const actorMap = new Map(actors.map((a) => [a.id, a]));
      enrichedLogs = correspondence.actionLogs.map((log) => ({
        ...log,
        actor: actorMap.get(log.actorId) ?? null,
      }));
    }

    return NextResponse.json({
      ...correspondence,
      actionLogs: enrichedLogs,
    });
  } catch (error) {
    logger.error("Failed to fetch correspondence", error, {
      route: "/api/correspondence/[id]",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/correspondence/[id] -- update correspondence
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

    const existing = await db.correspondence.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Correspondence not found" }, { status: 404 });
    }

    const {
      status,
      priority,
      subject,
      fromEntity,
      toEntity,
      dateReceived,
      dateSent,
      dueDate,
      description,
      dispatchMethod,
      trackingNumber,
      assignedToId,
      documentId,
    } = body as {
      status?: string;
      priority?: string;
      subject?: string;
      fromEntity?: string;
      toEntity?: string;
      dateReceived?: string | null;
      dateSent?: string | null;
      dueDate?: string | null;
      description?: string | null;
      dispatchMethod?: string | null;
      trackingNumber?: string | null;
      assignedToId?: string | null;
      documentId?: string | null;
    };

    // Validate status if provided
    const validStatuses = [
      "DRAFT", "RECEIVED", "REGISTERED", "ASSIGNED", "IN_PROGRESS",
      "PENDING_APPROVAL", "APPROVED", "DISPATCHED", "CLOSED", "OVERDUE",
    ];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Validate priority if provided
    const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    // Validate assignee if provided
    if (assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: assignedToId } });
      if (!assignee) {
        return NextResponse.json({ error: "Assigned user not found" }, { status: 404 });
      }
    }

    // Validate document if provided
    if (documentId) {
      const doc = await db.document.findUnique({ where: { id: documentId } });
      if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    // Build update data -- only include fields that were provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (subject !== undefined) updateData.subject = subject.trim();
    if (fromEntity !== undefined) updateData.fromEntity = fromEntity.trim();
    if (toEntity !== undefined) updateData.toEntity = toEntity.trim();
    if (dateReceived !== undefined) updateData.dateReceived = dateReceived ? new Date(dateReceived) : null;
    if (dateSent !== undefined) updateData.dateSent = dateSent ? new Date(dateSent) : null;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (dispatchMethod !== undefined) updateData.dispatchMethod = dispatchMethod || null;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber?.trim() || null;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId || null;
    if (documentId !== undefined) updateData.documentId = documentId || null;

    const updated = await db.correspondence.update({
      where: { id },
      data: updateData,
      include: {
        assignedTo: {
          select: { id: true, name: true, displayName: true, department: true },
        },
        createdBy: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    // Audit log
    await writeAudit({
      userId: session.user.id,
      action: "correspondence.updated",
      resourceType: "Correspondence",
      resourceId: id,
      metadata: {
        referenceNumber: existing.referenceNumber,
        changes: Object.keys(updateData),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update correspondence", error, {
      route: "/api/correspondence/[id]",
      method: "PATCH",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/correspondence/[id] -- delete correspondence
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.correspondence.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Correspondence not found" }, { status: 404 });
    }

    await db.correspondence.delete({ where: { id } });

    // Audit log
    await writeAudit({
      userId: session.user.id,
      action: "correspondence.deleted",
      resourceType: "Correspondence",
      resourceId: id,
      metadata: {
        referenceNumber: existing.referenceNumber,
        type: existing.type,
        subject: existing.subject,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete correspondence", error, {
      route: "/api/correspondence/[id]",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
