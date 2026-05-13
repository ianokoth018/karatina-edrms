import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

/** GET /api/admin/scan-batches?surveyId=...&status=... */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const surveyId = url.searchParams.get("surveyId");
    const status = url.searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (surveyId) where.surveyId = surveyId;
    if (status) where.status = status;

    const batches = await db.scanBatch.findMany({
      where,
      orderBy: { startedAt: "desc" },
      include: { survey: { select: { id: true, name: true, location: true } } },
    });
    return NextResponse.json({ batches });
  } catch (error) {
    logger.error("Failed to list scan batches", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface CreateBody {
  surveyId?: string | null;
  batchNumber?: string;
  operator?: string;
  scanner?: string;
  expectedPages?: number;
  notes?: string;
}

/** POST /api/admin/scan-batches — start a new batch */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as CreateBody;
    const batchNumber = (body.batchNumber ?? "").trim();
    const operator = (body.operator ?? "").trim();
    const scanner = (body.scanner ?? "").trim();
    if (!batchNumber) return NextResponse.json({ error: "Batch number is required" }, { status: 400 });
    if (!operator) return NextResponse.json({ error: "Operator is required" }, { status: 400 });
    if (!scanner) return NextResponse.json({ error: "Scanner is required" }, { status: 400 });

    // Validate surveyId if provided
    let surveyId: string | null = null;
    if (body.surveyId) {
      const survey = await db.recordsSurvey.findUnique({ where: { id: body.surveyId } });
      if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
      surveyId = survey.id;
    }

    const batch = await db.scanBatch.create({
      data: {
        surveyId,
        batchNumber,
        operator,
        scanner,
        expectedPages: Math.max(0, Number(body.expectedPages ?? 0) | 0),
        notes: body.notes?.trim() || null,
        status: "IN_PROGRESS",
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.scan_batch_started",
      resourceType: "ScanBatch",
      resourceId: batch.id,
      metadata: { batchNumber, operator, scanner, surveyId, expectedPages: batch.expectedPages },
    });

    return NextResponse.json({ batch }, { status: 201 });
  } catch (error: unknown) {
    const msg = (error as { code?: string })?.code === "P2002"
      ? "A batch with this number already exists"
      : "Internal error";
    logger.error("Failed to create scan batch", error);
    return NextResponse.json({ error: msg }, { status: msg.includes("already") ? 409 : 500 });
  }
}
