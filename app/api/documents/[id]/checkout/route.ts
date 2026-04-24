import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import crypto from "crypto";

const DEFAULT_CHECKOUT_HOURS = parseInt(process.env.CHECKOUT_EXPIRY_HOURS ?? "24", 10);

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/checkout — check out a document
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
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;

    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        referenceNumber: true,
        checkoutUserId: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.status === "DISPOSED" || document.status === "ARCHIVED") {
      return NextResponse.json(
        { error: `Cannot check out a document with status ${document.status}` },
        { status: 400 }
      );
    }

    if (document.checkoutUserId) {
      return NextResponse.json(
        { error: "Document is already checked out" },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({})) as { expiryHours?: number };
    const expiryHours = body.expiryHours ?? DEFAULT_CHECKOUT_HOURS;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const token = crypto.randomBytes(32).toString("hex");

    const updated = await db.document.update({
      where: { id },
      data: {
        status: "CHECKED_OUT",
        checkoutUserId: session.user.id,
        checkoutAt: new Date(),
        checkoutExpiresAt: expiresAt,
        checkoutToken: token,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.checked_out",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: { referenceNumber: document.referenceNumber },
    });

    logger.info("Document checked out", {
      userId: session.user.id,
      action: "document.checked_out",
      route: `/api/documents/${id}/checkout`,
      method: "POST",
    });

    return NextResponse.json({
      message: "Document checked out successfully",
      checkoutUserId: updated.checkoutUserId,
      checkoutAt: updated.checkoutAt,
      checkoutExpiresAt: updated.checkoutExpiresAt,
      checkoutToken: token,
    });
  } catch (error) {
    logger.error("Failed to check out document", error, {
      route: "/api/documents/[id]/checkout",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/documents/[id]/checkout — check in a document
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;

    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        referenceNumber: true,
        checkoutUserId: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!document.checkoutUserId) {
      return NextResponse.json(
        { error: "Document is not checked out" },
        { status: 400 }
      );
    }

    // Only the user who checked it out (or an admin) can check it back in
    if (document.checkoutUserId !== session.user.id) {
      const isAdmin = session.user.roles?.some(
        (r: string) => r.toLowerCase() === "admin" || r.toLowerCase() === "super_admin"
      );
      if (!isAdmin) {
        return NextResponse.json(
          { error: "Only the user who checked out this document (or an admin) can check it in" },
          { status: 403 }
        );
      }
    }

    await db.document.update({
      where: { id },
      data: {
        status: "ACTIVE",
        checkoutUserId: null,
        checkoutAt: null,
        checkoutExpiresAt: null,
        checkoutToken: null,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.checked_in",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: { referenceNumber: document.referenceNumber },
    });

    logger.info("Document checked in", {
      userId: session.user.id,
      action: "document.checked_in",
      route: `/api/documents/${id}/checkout`,
      method: "DELETE",
    });

    return NextResponse.json({ message: "Document checked in successfully" });
  } catch (error) {
    logger.error("Failed to check in document", error, {
      route: "/api/documents/[id]/checkout",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
