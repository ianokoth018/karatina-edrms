import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/physical/[id] -- Get a single physical record with movements
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

    const record = await db.physicalRecord.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { occurredAt: "desc" },
          take: 20,
        },
      },
    });

    if (!record) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    // Look up performer info for each movement
    const performerIds = [...new Set(record.movements.map((m) => m.performedById))];
    const performers = performerIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: performerIds } },
          select: {
            id: true,
            name: true,
            displayName: true,
            department: true,
            jobTitle: true,
          },
        })
      : [];

    const performerMap = new Map(performers.map((p) => [p.id, p]));

    // Look up checked-out-to user if applicable
    let checkedOutUser = null;
    if (record.checkedOutTo) {
      checkedOutUser = await db.user.findUnique({
        where: { id: record.checkedOutTo },
        select: {
          id: true,
          name: true,
          displayName: true,
          department: true,
          jobTitle: true,
        },
      });
    }

    return NextResponse.json({
      ...record,
      checkedOutUser,
      movements: record.movements.map((m) => ({
        ...m,
        performer: performerMap.get(m.performedById) ?? null,
      })),
    });
  } catch (error) {
    logger.error("Failed to fetch physical record", error, {
      route: "/api/records/physical/[id]",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/physical/[id] -- Update a physical record
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

    const existing = await db.physicalRecord.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    if (existing.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Cannot update a disposed record" },
        { status: 400 },
      );
    }

    // Only allow updating specific fields
    const allowedFields = [
      "title",
      "boxNumber",
      "shelfLocation",
      "offSiteLocation",
      "barcode",
      "documentId",
    ] as const;

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        const value = body[field];
        data[field] = typeof value === "string" ? value.trim() || null : value;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    // Check barcode uniqueness if changing barcode
    if (data.barcode && data.barcode !== existing.barcode) {
      const barcodeExists = await db.physicalRecord.findUnique({
        where: { barcode: data.barcode as string },
      });
      if (barcodeExists) {
        return NextResponse.json(
          { error: "A record with this barcode already exists" },
          { status: 409 },
        );
      }
    }

    const record = await db.physicalRecord.update({
      where: { id },
      data,
    });

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.update",
      resourceType: "PhysicalRecord",
      resourceId: record.id,
      metadata: {
        referenceNumber: record.referenceNumber,
        updatedFields: Object.keys(data),
      },
    });

    return NextResponse.json(record);
  } catch (error) {
    logger.error("Failed to update physical record", error, {
      route: "/api/records/physical/[id]",
      method: "PATCH",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/records/physical/[id] -- Soft-delete by setting status to DISPOSED
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

    const existing = await db.physicalRecord.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    if (existing.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Record is already disposed" },
        { status: 400 },
      );
    }

    if (existing.status === "CHECKED_OUT") {
      return NextResponse.json(
        { error: "Cannot dispose a checked-out record. Check it in first." },
        { status: 400 },
      );
    }

    const record = await db.physicalRecord.update({
      where: { id },
      data: {
        status: "DISPOSED",
        checkedOutTo: null,
        checkedOutAt: null,
        expectedReturnAt: null,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.dispose",
      resourceType: "PhysicalRecord",
      resourceId: record.id,
      metadata: {
        referenceNumber: record.referenceNumber,
        previousStatus: existing.status,
      },
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    logger.error("Failed to dispose physical record", error, {
      route: "/api/records/physical/[id]",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
