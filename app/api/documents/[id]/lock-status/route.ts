import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/documents/[id]/lock-status
// Returns checkout state and version workflow status
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
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
        status: true,
        checkoutUserId: true,
        checkoutAt: true,
        checkoutExpiresAt: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    let checkoutUser: { id: string; name: string; displayName: string } | null = null;
    if (document.checkoutUserId) {
      checkoutUser = await db.user.findUnique({
        where: { id: document.checkoutUserId },
        select: { id: true, name: true, displayName: true },
      });
    }

    const latestVersion = await db.documentVersion.findFirst({
      where: { documentId: id, isLatest: true },
      select: { id: true, versionNum: true, status: true, label: true },
    });

    const pendingReview = await db.documentVersion.count({
      where: { documentId: id, status: "IN_REVIEW" },
    });

    const isLockedByCurrentUser = document.checkoutUserId === session.user.id;
    const isExpired =
      document.checkoutExpiresAt != null && document.checkoutExpiresAt < new Date();

    return NextResponse.json({
      isCheckedOut: !!document.checkoutUserId,
      isLockedByCurrentUser,
      isExpired,
      checkoutUserId: document.checkoutUserId,
      checkoutUser,
      checkoutAt: document.checkoutAt?.toISOString() ?? null,
      checkoutExpiresAt: document.checkoutExpiresAt?.toISOString() ?? null,
      documentStatus: document.status,
      latestVersion,
      pendingReviewCount: pendingReview,
    });
  } catch (error) {
    logger.error("Lock status query failed", error, {
      route: "/api/documents/[id]/lock-status",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
