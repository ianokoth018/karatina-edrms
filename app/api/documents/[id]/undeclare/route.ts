import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { canDeclareRecords } from "@/lib/record-declaration";

/**
 * POST /api/documents/[id]/undeclare
 *
 * Reverses a prior record declaration. Locked behind records:manage /
 * records:declare / admin:manage and requires a justification, since
 * undeclaring is a meaningful records-management event under DoD 5015.2.
 * The audit log preserves the original declaredAt + declaredBy values
 * inside the metadata so the action remains traceable after the row is
 * reset.
 *
 * Body: { reason: string }   // required, ≥ 5 chars
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canDeclareRecords(session.user.permissions ?? [])) {
      return NextResponse.json(
        { error: "You need records:manage or admin:manage to undeclare a record." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { reason?: string } | null;
    const reason = body?.reason?.trim();
    if (!reason || reason.length < 5) {
      return NextResponse.json(
        { error: "A justification of at least 5 characters is required to undeclare a record." },
        { status: 400 },
      );
    }

    const existing = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        declaredAsRecordAt: true,
        declaredById: true,
        recordDeclarationReason: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (!existing.declaredAsRecordAt) {
      return NextResponse.json(
        { error: "This document is not currently declared as a record." },
        { status: 409 },
      );
    }

    await db.document.update({
      where: { id },
      data: {
        declaredAsRecordAt: null,
        declaredById: null,
        recordDeclarationReason: null,
      },
    });

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.record_undeclared",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        referenceNumber: existing.referenceNumber,
        title: existing.title,
        reason,
        priorDeclaredAt: existing.declaredAsRecordAt.toISOString(),
        priorDeclaredById: existing.declaredById,
        priorReason: existing.recordDeclarationReason,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to undeclare record", error, {
      route: "/api/documents/[id]/undeclare",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
