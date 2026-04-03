import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// GET /api/records/retention/[id] -- get a single retention schedule
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

    const schedule = await db.retentionSchedule.findUnique({
      where: { id },
      include: {
        classificationNode: true,
      },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "Retention schedule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(schedule);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/retention/[id] -- update a retention schedule
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

    // Verify the schedule exists
    const existing = await db.retentionSchedule.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Retention schedule not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { classificationNodeId, activeYears, inactiveYears, disposalAction, legalBasis } =
      body as {
        classificationNodeId?: string;
        activeYears?: number;
        inactiveYears?: number;
        disposalAction?: string;
        legalBasis?: string | null;
      };

    // Validate classificationNodeId if provided
    if (classificationNodeId !== undefined) {
      const node = await db.classificationNode.findUnique({
        where: { id: classificationNodeId },
      });
      if (!node) {
        return NextResponse.json(
          { error: "Classification node not found" },
          { status: 404 }
        );
      }
    }

    // Validate numeric fields if provided
    if (activeYears !== undefined && (typeof activeYears !== "number" || activeYears < 0)) {
      return NextResponse.json(
        { error: "activeYears must be a non-negative number" },
        { status: 400 }
      );
    }
    if (inactiveYears !== undefined && (typeof inactiveYears !== "number" || inactiveYears < 0)) {
      return NextResponse.json(
        { error: "inactiveYears must be a non-negative number" },
        { status: 400 }
      );
    }

    // Validate disposalAction if provided
    if (disposalAction !== undefined) {
      const validDisposalActions = ["DESTROY", "ARCHIVE_PERMANENT", "REVIEW"];
      if (!validDisposalActions.includes(disposalAction)) {
        return NextResponse.json(
          { error: "disposalAction must be DESTROY, ARCHIVE_PERMANENT, or REVIEW" },
          { status: 400 }
        );
      }
    }

    // Recalculate totalYears using provided values or falling back to existing
    const finalActiveYears = activeYears ?? existing.activeYears;
    const finalInactiveYears = inactiveYears ?? existing.inactiveYears;
    const totalYears = finalActiveYears + finalInactiveYears;

    // Build update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { totalYears };
    if (classificationNodeId !== undefined) updateData.classificationNodeId = classificationNodeId;
    if (activeYears !== undefined) updateData.activeYears = activeYears;
    if (inactiveYears !== undefined) updateData.inactiveYears = inactiveYears;
    if (disposalAction !== undefined) updateData.disposalAction = disposalAction;
    if (legalBasis !== undefined) updateData.legalBasis = legalBasis?.trim() || null;

    const schedule = await db.retentionSchedule.update({
      where: { id },
      data: updateData,
      include: {
        classificationNode: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "retention_schedule.updated",
      resourceType: "RetentionSchedule",
      resourceId: schedule.id,
      metadata: {
        updatedFields: Object.keys(body),
        totalYears,
      },
    });

    return NextResponse.json(schedule);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/records/retention/[id] -- delete a retention schedule
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

    // Verify the schedule exists
    const existing = await db.retentionSchedule.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Retention schedule not found" },
        { status: 404 }
      );
    }

    await db.retentionSchedule.delete({
      where: { id },
    });

    await writeAudit({
      userId: session.user.id,
      action: "retention_schedule.deleted",
      resourceType: "RetentionSchedule",
      resourceId: id,
      metadata: {
        classificationNodeId: existing.classificationNodeId,
        disposalAction: existing.disposalAction,
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
