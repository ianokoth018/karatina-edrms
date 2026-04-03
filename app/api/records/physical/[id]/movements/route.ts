import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/physical/[id]/movements -- List all movements for a record
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

    // Verify the record exists
    const record = await db.physicalRecord.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true },
    });

    if (!record) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    const movements = await db.physicalRecordMovement.findMany({
      where: { physicalRecordId: id },
      orderBy: { occurredAt: "desc" },
    });

    // Look up performer info
    const performerIds = [...new Set(movements.map((m) => m.performedById))];
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

    return NextResponse.json({
      data: movements.map((m) => ({
        ...m,
        performer: performerMap.get(m.performedById) ?? null,
      })),
    });
  } catch (error) {
    logger.error("Failed to list physical record movements", error, {
      route: "/api/records/physical/[id]/movements",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/physical/[id]/movements -- Record a new movement
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
    const { action, fromLocation, toLocation, notes } = body as {
      action?: string;
      fromLocation?: string;
      toLocation?: string;
      notes?: string;
    };

    if (!action?.trim()) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const record = await db.physicalRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Physical record not found" }, { status: 404 });
    }

    if (record.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Cannot record movements for a disposed record" },
        { status: 400 },
      );
    }

    // Build record update data if toLocation is provided
    const recordUpdate: Record<string, unknown> = {};
    if (toLocation?.trim()) {
      // Determine if the toLocation is an off-site location or a shelf location.
      // Convention: off-site locations typically contain "off-site" or "offsite",
      // but we default to shelfLocation since that is the more common field.
      const trimmedTo = toLocation.trim();
      if (trimmedTo.toLowerCase().includes("offsite") || trimmedTo.toLowerCase().includes("off-site")) {
        recordUpdate.offSiteLocation = trimmedTo;
      } else {
        recordUpdate.shelfLocation = trimmedTo;
      }

      // If the action indicates a transfer, update the status
      if (action.trim().toUpperCase() === "TRANSFER") {
        recordUpdate.status = "TRANSFERRED";
      }
    }

    const [movement] = await db.$transaction([
      db.physicalRecordMovement.create({
        data: {
          physicalRecordId: id,
          action: action.trim().toUpperCase(),
          fromLocation: fromLocation?.trim() || null,
          toLocation: toLocation?.trim() || null,
          performedById: session.user.id,
          notes: notes?.trim() || null,
        },
      }),
      ...(Object.keys(recordUpdate).length > 0
        ? [db.physicalRecord.update({ where: { id }, data: recordUpdate })]
        : []),
    ]);

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.movement",
      resourceType: "PhysicalRecord",
      resourceId: id,
      metadata: {
        referenceNumber: record.referenceNumber,
        movementAction: action.trim().toUpperCase(),
        fromLocation: fromLocation?.trim() || null,
        toLocation: toLocation?.trim() || null,
      },
    });

    return NextResponse.json(movement, { status: 201 });
  } catch (error) {
    logger.error("Failed to record physical record movement", error, {
      route: "/api/records/physical/[id]/movements",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
