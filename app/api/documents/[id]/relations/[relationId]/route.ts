import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// DELETE /api/documents/[id]/relations/[relationId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; relationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, relationId } = await params;

    const relation = await db.documentRelation.findFirst({
      where: { id: relationId, sourceId: id },
    });
    if (!relation) return NextResponse.json({ error: "Relation not found" }, { status: 404 });

    const isOwner = relation.createdById === session.user.id;
    const isAdmin = (session.user as { roles?: string[] }).roles?.some(
      (r) => ["admin", "super_admin"].includes(r.toLowerCase())
    );
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Not authorized to delete this relation" }, { status: 403 });
    }

    await db.documentRelation.delete({ where: { id: relationId } });

    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.relation_removed",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { relationId, relationType: relation.relationType, targetId: relation.targetId },
    });

    return NextResponse.json({ message: "Relation removed" });
  } catch (error) {
    logger.error("Failed to delete relation", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
