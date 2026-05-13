import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

/**
 * DELETE /api/documents/[id]/redactions/[redactionId]
 *
 * Removes a single DocumentRedaction row. The burned PDF on disk is left in
 * place — past redactions are intentionally durable so older share links and
 * audit trails keep working. Only the registry entry is dropped, which makes
 * the rectangle disappear from the canvas overlay.
 *
 * The `redactionId` accepted may be either a real DocumentRedaction id or
 * the composite `${rowId}:${regionIndex}` id the GET endpoint emits when a
 * row contains multiple regions; in the latter case we still delete the
 * underlying row since all its regions share one burned file.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; redactionId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id, redactionId } = await params;
    const perms = await getEffectiveDocumentPermissions(session, id);
    if (!perms.canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Composite ids look like `${rowId}:${regionIdx}`. Strip the suffix.
    const rowId = redactionId.includes(":")
      ? redactionId.split(":")[0]
      : redactionId;

    const existing = await db.documentRedaction.findFirst({
      where: { id: rowId, documentId: id },
      select: { id: true, fileId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.documentRedaction.delete({ where: { id: existing.id } });

    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.redaction.removed",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { redactionId: existing.id, fileId: existing.fileId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete redaction", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
