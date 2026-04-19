import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

/**
 * DELETE /api/documents/[id]/share-link/[linkId] — revoke a share link.
 *
 * Soft revocation: sets revokedAt + revokedById. The public viewer endpoint
 * returns 410 Gone for any link that has a non-null revokedAt. Requires
 * canShare on the parent document.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: documentId, linkId } = await params;

    const perms = await getEffectiveDocumentPermissions(session, documentId);
    if (!perms.canShare) {
      return NextResponse.json(
        { error: "You do not have permission to revoke share links" },
        { status: 403 }
      );
    }

    const link = await db.documentShareLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        documentId: true,
        revokedAt: true,
        email: true,
      },
    });

    if (!link || link.documentId !== documentId) {
      return NextResponse.json(
        { error: "Share link not found for this document" },
        { status: 404 }
      );
    }

    if (link.revokedAt) {
      return NextResponse.json(
        { error: "Share link is already revoked" },
        { status: 400 }
      );
    }

    const now = new Date();
    await db.documentShareLink.update({
      where: { id: linkId },
      data: {
        revokedAt: now,
        revokedById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.share_link_revoked",
      resourceType: "Document",
      resourceId: documentId,
      metadata: {
        linkId,
        email: link.email,
        revokedAt: now.toISOString(),
      },
    });

    logger.info("Document share link revoked", {
      userId: session.user.id,
      documentId,
      linkId,
    });

    return NextResponse.json({ message: "Share link revoked" });
  } catch (error) {
    logger.error("Failed to revoke share link", error, {
      route: "/api/documents/[id]/share-link/[linkId]",
      method: "DELETE",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
