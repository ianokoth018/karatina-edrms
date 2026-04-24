import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/checkout/force — admin force check-in
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

    const isAdmin = (session.user as { roles?: string[] }).roles?.some(
      (r) => ["admin", "super_admin"].includes(r.toLowerCase())
    );
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        checkoutUserId: true,
        status: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!document.checkoutUserId) {
      return NextResponse.json({ error: "Document is not checked out" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as { reason?: string };

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

    // Notify the user whose lock was broken
    await db.notification.create({
      data: {
        userId: document.checkoutUserId,
        type: "CHECKOUT_FORCE_RELEASED",
        title: `Document lock released: #${document.referenceNumber}`,
        body: body.reason
          ? `An admin force-released your lock. Reason: ${body.reason}`
          : "An admin force-released your document lock.",
        linkUrl: `/records/documents/${id}`,
      },
    }).catch(() => {});

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.force_checked_in",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: {
        previousOwner: document.checkoutUserId,
        reason: body.reason,
        referenceNumber: document.referenceNumber,
      },
    });

    logger.info("Document force-checked in", {
      adminId: session.user.id,
      documentId: id,
      previousOwner: document.checkoutUserId,
    });

    return NextResponse.json({ message: "Document lock released successfully" });
  } catch (error) {
    logger.error("Force check-in failed", error, {
      route: "/api/documents/[id]/checkout/force",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
