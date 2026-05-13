import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

const VALID_CONDITIONS = new Set(["GOOD", "FAIR", "POOR"]);
const VALID_STATUSES = new Set(["PLANNED", "IN_PROGRESS", "COMPLETED"]);

/** GET /api/admin/surveys?status=PLANNED — list surveys with batch counts */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const where = status && VALID_STATUSES.has(status) ? { status } : {};

    const surveys = await db.recordsSurvey.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { scanBatches: true } } },
    });
    return NextResponse.json({ surveys });
  } catch (error) {
    logger.error("Failed to list records surveys", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SurveyBody {
  name?: string;
  location?: string;
  estimatedVolume?: number;
  actualVolume?: number;
  boxCount?: number;
  earliestDate?: string;
  latestDate?: string;
  condition?: string;
  notes?: string;
  status?: string;
}

/** POST /api/admin/surveys — create a new records survey */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as SurveyBody;
    const name = (body.name ?? "").trim();
    const location = (body.location ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!location) return NextResponse.json({ error: "Location is required" }, { status: 400 });

    const condition = (body.condition ?? "FAIR").toUpperCase();
    if (!VALID_CONDITIONS.has(condition))
      return NextResponse.json({ error: "Condition must be GOOD, FAIR or POOR" }, { status: 400 });

    const status = (body.status ?? "PLANNED").toUpperCase();
    if (!VALID_STATUSES.has(status))
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });

    const survey = await db.recordsSurvey.create({
      data: {
        name,
        location,
        estimatedVolume: Math.max(0, Number(body.estimatedVolume ?? 0) | 0),
        actualVolume: Math.max(0, Number(body.actualVolume ?? 0) | 0),
        boxCount: Math.max(0, Number(body.boxCount ?? 0) | 0),
        earliestDate: body.earliestDate?.trim() || null,
        latestDate: body.latestDate?.trim() || null,
        condition,
        notes: body.notes?.trim() || null,
        status,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.records_survey_created",
      resourceType: "RecordsSurvey",
      resourceId: survey.id,
      metadata: { name, location, condition, estimatedVolume: survey.estimatedVolume },
    });

    return NextResponse.json({ survey }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create records survey", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
