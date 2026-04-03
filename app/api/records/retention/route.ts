import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// GET /api/records/retention -- list all retention schedules
// Supports ?classificationNodeId=xxx filter
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const classificationNodeId = searchParams.get("classificationNodeId");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (classificationNodeId) {
      where.classificationNodeId = classificationNodeId;
    }

    const schedules = await db.retentionSchedule.findMany({
      where,
      include: {
        classificationNode: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ schedules });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/retention -- create a retention schedule
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { classificationNodeId, activeYears, inactiveYears, disposalAction, legalBasis } =
      body as {
        classificationNodeId: string;
        activeYears: number;
        inactiveYears: number;
        disposalAction: string;
        legalBasis?: string;
      };

    // Validate required fields
    if (!classificationNodeId) {
      return NextResponse.json(
        { error: "classificationNodeId is required" },
        { status: 400 }
      );
    }
    if (activeYears == null || typeof activeYears !== "number" || activeYears < 0) {
      return NextResponse.json(
        { error: "activeYears must be a non-negative number" },
        { status: 400 }
      );
    }
    if (inactiveYears == null || typeof inactiveYears !== "number" || inactiveYears < 0) {
      return NextResponse.json(
        { error: "inactiveYears must be a non-negative number" },
        { status: 400 }
      );
    }

    const validDisposalActions = ["DESTROY", "ARCHIVE_PERMANENT", "REVIEW"];
    if (!disposalAction || !validDisposalActions.includes(disposalAction)) {
      return NextResponse.json(
        { error: "disposalAction must be DESTROY, ARCHIVE_PERMANENT, or REVIEW" },
        { status: 400 }
      );
    }

    // Validate classificationNodeId exists
    const node = await db.classificationNode.findUnique({
      where: { id: classificationNodeId },
    });
    if (!node) {
      return NextResponse.json(
        { error: "Classification node not found" },
        { status: 404 }
      );
    }

    const totalYears = activeYears + inactiveYears;

    const schedule = await db.retentionSchedule.create({
      data: {
        classificationNodeId,
        activeYears,
        inactiveYears,
        totalYears,
        disposalAction: disposalAction as "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW",
        legalBasis: legalBasis?.trim() || null,
      },
      include: {
        classificationNode: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "retention_schedule.created",
      resourceType: "RetentionSchedule",
      resourceId: schedule.id,
      metadata: {
        classificationNodeId,
        activeYears,
        inactiveYears,
        totalYears,
        disposalAction,
      },
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
