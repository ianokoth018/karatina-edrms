import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "task-attachments");

/** GET /api/workflows/tasks/[id]/attachments/[attachId] — download attachment */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, attachId } = await params;
    const attachment = await db.taskAttachment.findUnique({ where: { id: attachId } });
    if (!attachment || attachment.taskId !== id) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const storedName = path.basename(attachment.storagePath);
    const fullPath = path.join(UPLOAD_DIR, storedName);

    const buffer = await fs.readFile(fullPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
        "Content-Length": String(attachment.sizeBytes),
      },
    });
  } catch (error) {
    logger.error("Failed to download task attachment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/workflows/tasks/[id]/attachments/[attachId] — remove attachment */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, attachId } = await params;
    const attachment = await db.taskAttachment.findUnique({ where: { id: attachId } });
    if (!attachment || attachment.taskId !== id) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const isAdmin =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");

    if (attachment.uploadedById !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "You can only delete your own attachments" }, { status: 403 });
    }

    await db.taskAttachment.delete({ where: { id: attachId } });

    // Best-effort file removal
    try {
      const storedName = path.basename(attachment.storagePath);
      await fs.unlink(path.join(UPLOAD_DIR, storedName));
    } catch {
      logger.warn("Could not remove attachment file from disk", { attachId });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete task attachment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
