import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** PATCH /api/workflows/tasks/[id]/comments/[commentId] — edit own comment */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, commentId } = await params;

    const comment = await db.taskComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== id) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const isAdmin =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");

    if (comment.authorId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "You can only edit your own comments" }, { status: 403 });
    }

    const body = await req.json();
    const { body: text } = body as { body: string };
    if (!text?.trim()) return NextResponse.json({ error: "Body is required" }, { status: 400 });

    const updated = await db.taskComment.update({
      where: { id: commentId },
      data: { body: text.trim(), editedAt: new Date() },
      include: {
        author: { select: { id: true, name: true, displayName: true, email: true } },
      },
    });

    return NextResponse.json({ comment: updated });
  } catch (error) {
    logger.error("Failed to edit task comment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/workflows/tasks/[id]/comments/[commentId] — soft-delete */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, commentId } = await params;

    const comment = await db.taskComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== id) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const isAdmin =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");

    if (comment.authorId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "You can only delete your own comments" }, { status: 403 });
    }

    await db.taskComment.update({
      where: { id: commentId },
      data: { body: "[deleted]" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete task comment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
