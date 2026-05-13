import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

const VALID_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "REJECTED"]);

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/scan-batches/[id] */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const batch = await db.scanBatch.findUnique({
      where: { id },
      include: { survey: { select: { id: true, name: true, location: true } } },
    });
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ batch });
  } catch (error) {
    logger.error("Failed to get scan batch", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface PatchBody {
  operator?: string;
  scanner?: string;
  expectedPages?: number;
  actualPages?: number;
  legibleCount?: number;
  illegibleCount?: number;
  skewedCount?: number;
  blankCount?: number;
  missingCount?: number;
  notes?: string | null;
  status?: string;
}

/** PATCH /api/admin/scan-batches/[id] — record QA counts / update */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json()) as PatchBody;

    const data: Record<string, unknown> = {};
    if (body.operator !== undefined) data.operator = body.operator.trim();
    if (body.scanner !== undefined) data.scanner = body.scanner.trim();
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

    for (const key of [
      "expectedPages",
      "actualPages",
      "legibleCount",
      "illegibleCount",
      "skewedCount",
      "blankCount",
      "missingCount",
    ] as const) {
      const v = body[key];
      if (v !== undefined) data[key] = Math.max(0, Number(v) | 0);
    }

    if (body.status !== undefined) {
      const s = body.status.toUpperCase();
      if (!VALID_STATUSES.has(s))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      data.status = s;
    }

    const batch = await db.scanBatch.update({ where: { id }, data });

    await writeAudit({
      userId: session.user.id,
      action: "admin.scan_batch_updated",
      resourceType: "ScanBatch",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
    });

    return NextResponse.json({ batch });
  } catch (error) {
    logger.error("Failed to update scan batch", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/scan-batches/[id] */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await db.scanBatch.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.scanBatch.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "admin.scan_batch_deleted",
      resourceType: "ScanBatch",
      resourceId: id,
      metadata: { batchNumber: existing.batchNumber },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete scan batch", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
