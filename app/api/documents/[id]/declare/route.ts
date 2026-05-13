import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { canDeclareRecords } from "@/lib/record-declaration";

/**
 * POST /api/documents/[id]/declare
 *
 * Declares the document as a formal record (DoD 5015.2 / ISO 16175). Once
 * declared, the document is immutable: edits, deletes, new versions,
 * retention/classification changes are rejected. Only an admin (or someone
 * with records:manage / records:declare) can reverse the declaration via
 * the companion /undeclare endpoint, and reversal is fully audited.
 *
 * Body: { reason?: string }
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
        { error: "You need the records:declare or records:manage permission to declare a record." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { reason?: string } | null;
    const reason = body?.reason?.trim() || null;

    const existing = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        status: true,
        declaredAsRecordAt: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (existing.status === "DISPOSED") {
      return NextResponse.json(
        { error: "A disposed document cannot be declared as a record." },
        { status: 400 },
      );
    }
    if (existing.declaredAsRecordAt) {
      return NextResponse.json(
        {
          error: "This document is already declared as a record.",
          declaredAt: existing.declaredAsRecordAt.toISOString(),
        },
        { status: 409 },
      );
    }

    const declaredAt = new Date();
    const updated = await db.document.update({
      where: { id },
      data: {
        declaredAsRecordAt: declaredAt,
        declaredById: session.user.id,
        recordDeclarationReason: reason,
      },
      select: {
        id: true,
        referenceNumber: true,
        declaredAsRecordAt: true,
        declaredById: true,
        recordDeclarationReason: true,
      },
    });

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.record_declared",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        referenceNumber: existing.referenceNumber,
        title: existing.title,
        reason,
      },
    });

    return NextResponse.json({
      success: true,
      document: {
        ...updated,
        declaredAsRecordAt: updated.declaredAsRecordAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    logger.error("Failed to declare record", error, {
      route: "/api/documents/[id]/declare",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
