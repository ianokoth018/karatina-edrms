import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/records/physical/[id]/checkout -- Check out a physical record
// ---------------------------------------------------------------------------
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
    const { expectedReturnAt, notes } = body as {
      expectedReturnAt?: string;
      notes?: string;
    };

    const record = await db.physicalRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    if (record.status !== "AVAILABLE") {
      return NextResponse.json(
        { error: `Record is not available for checkout (current status: ${record.status})` },
        { status: 400 },
      );
    }

    const now = new Date();
    const parsedReturnAt = expectedReturnAt ? new Date(expectedReturnAt) : null;

    if (parsedReturnAt && isNaN(parsedReturnAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid expectedReturnAt date" },
        { status: 400 },
      );
    }

    const [updatedRecord] = await db.$transaction([
      db.physicalRecord.update({
        where: { id },
        data: {
          status: "CHECKED_OUT",
          checkedOutTo: session.user.id,
          checkedOutAt: now,
          expectedReturnAt: parsedReturnAt,
        },
      }),
      db.physicalRecordMovement.create({
        data: {
          physicalRecordId: id,
          action: "CHECKOUT",
          fromLocation: record.shelfLocation ?? record.offSiteLocation ?? null,
          toLocation: null,
          performedById: session.user.id,
          notes: notes?.trim() || null,
        },
      }),
    ]);

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.checkout",
      resourceType: "PhysicalRecord",
      resourceId: id,
      metadata: {
        referenceNumber: record.referenceNumber,
        expectedReturnAt: parsedReturnAt?.toISOString() ?? null,
      },
    });

    return NextResponse.json(updatedRecord);
  } catch (error) {
    logger.error("Failed to check out physical record", error, {
      route: "/api/records/physical/[id]/checkout",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/records/physical/[id]/checkout -- Check in a physical record
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

    const record = await db.physicalRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    if (record.status !== "CHECKED_OUT") {
      return NextResponse.json(
        { error: "Record is not currently checked out" },
        { status: 400 },
      );
    }

    const [updatedRecord] = await db.$transaction([
      db.physicalRecord.update({
        where: { id },
        data: {
          status: "AVAILABLE",
          checkedOutTo: null,
          checkedOutAt: null,
          expectedReturnAt: null,
        },
      }),
      db.physicalRecordMovement.create({
        data: {
          physicalRecordId: id,
          action: "CHECKIN",
          fromLocation: null,
          toLocation: record.shelfLocation ?? record.offSiteLocation ?? null,
          performedById: session.user.id,
          notes: null,
        },
      }),
    ]);

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.checkin",
      resourceType: "PhysicalRecord",
      resourceId: id,
      metadata: {
        referenceNumber: record.referenceNumber,
        checkedOutTo: record.checkedOutTo,
        checkedOutAt: record.checkedOutAt?.toISOString() ?? null,
      },
    });

    return NextResponse.json(updatedRecord);
  } catch (error) {
    logger.error("Failed to check in physical record", error, {
      route: "/api/records/physical/[id]/checkout",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
