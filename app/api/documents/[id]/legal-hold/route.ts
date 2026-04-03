import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/legal-hold — place document on legal hold
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
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        { error: "A reason for the legal hold is required" },
        { status: 400 }
      );
    }

    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        isOnLegalHold: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.isOnLegalHold) {
      return NextResponse.json(
        { error: "Document is already on legal hold" },
        { status: 409 }
      );
    }

    const updated = await db.document.update({
      where: { id },
      data: {
        isOnLegalHold: true,
        legalHoldReason: reason.trim(),
        legalHoldAt: new Date(),
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.legal_hold_placed",
      resourceType: "Document",
      resourceId: id,
      metadata: {
        reason: reason.trim(),
        referenceNumber: document.referenceNumber,
      },
    });

    logger.info("Document placed on legal hold", {
      userId: session.user.id,
      action: "document.legal_hold_placed",
      route: `/api/documents/${id}/legal-hold`,
      method: "POST",
    });

    return NextResponse.json({
      message: "Document placed on legal hold",
      isOnLegalHold: updated.isOnLegalHold,
      legalHoldReason: updated.legalHoldReason,
      legalHoldAt: updated.legalHoldAt,
    });
  } catch (error) {
    logger.error("Failed to place legal hold", error, {
      route: "/api/documents/[id]/legal-hold",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/documents/[id]/legal-hold — release legal hold
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

    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        isOnLegalHold: true,
        legalHoldReason: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!document.isOnLegalHold) {
      return NextResponse.json(
        { error: "Document is not on legal hold" },
        { status: 400 }
      );
    }

    await db.document.update({
      where: { id },
      data: {
        isOnLegalHold: false,
        legalHoldReason: null,
        legalHoldAt: null,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.legal_hold_released",
      resourceType: "Document",
      resourceId: id,
      metadata: {
        previousReason: document.legalHoldReason,
        referenceNumber: document.referenceNumber,
      },
    });

    logger.info("Document legal hold released", {
      userId: session.user.id,
      action: "document.legal_hold_released",
      route: `/api/documents/${id}/legal-hold`,
      method: "DELETE",
    });

    return NextResponse.json({ message: "Legal hold released successfully" });
  } catch (error) {
    logger.error("Failed to release legal hold", error, {
      route: "/api/documents/[id]/legal-hold",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
