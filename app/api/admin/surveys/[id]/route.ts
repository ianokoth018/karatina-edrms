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

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/surveys/[id] — detail with batches */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const survey = await db.recordsSurvey.findUnique({
      where: { id },
      include: {
        scanBatches: { orderBy: { startedAt: "desc" } },
      },
    });
    if (!survey) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ survey });
  } catch (error) {
    logger.error("Failed to get records survey", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface PatchBody {
  name?: string;
  location?: string;
  estimatedVolume?: number;
  actualVolume?: number;
  boxCount?: number;
  earliestDate?: string | null;
  latestDate?: string | null;
  condition?: string;
  notes?: string | null;
  status?: string;
}

/** PATCH /api/admin/surveys/[id] — update fields/status */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json()) as PatchBody;

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.location !== undefined) data.location = body.location.trim();
    if (body.estimatedVolume !== undefined) data.estimatedVolume = Math.max(0, Number(body.estimatedVolume) | 0);
    if (body.actualVolume !== undefined) data.actualVolume = Math.max(0, Number(body.actualVolume) | 0);
    if (body.boxCount !== undefined) data.boxCount = Math.max(0, Number(body.boxCount) | 0);
    if (body.earliestDate !== undefined) data.earliestDate = body.earliestDate?.trim() || null;
    if (body.latestDate !== undefined) data.latestDate = body.latestDate?.trim() || null;
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
    if (body.condition !== undefined) {
      const c = body.condition.toUpperCase();
      if (!VALID_CONDITIONS.has(c))
        return NextResponse.json({ error: "Condition must be GOOD, FAIR or POOR" }, { status: 400 });
      data.condition = c;
    }
    if (body.status !== undefined) {
      const s = body.status.toUpperCase();
      if (!VALID_STATUSES.has(s))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      data.status = s;
    }

    const survey = await db.recordsSurvey.update({ where: { id }, data });

    await writeAudit({
      userId: session.user.id,
      action: "admin.records_survey_updated",
      resourceType: "RecordsSurvey",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });

    return NextResponse.json({ survey });
  } catch (error) {
    logger.error("Failed to update records survey", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/surveys/[id] */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await db.recordsSurvey.findUnique({
      where: { id },
      include: { _count: { select: { scanBatches: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing._count.scanBatches > 0)
      return NextResponse.json(
        { error: "Cannot delete a survey that has scan batches. Delete the batches first." },
        { status: 409 }
      );

    await db.recordsSurvey.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "admin.records_survey_deleted",
      resourceType: "RecordsSurvey",
      resourceId: id,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete records survey", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
