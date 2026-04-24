import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "task-attachments");
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/** GET /api/workflows/tasks/[id]/attachments — list attachments */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const task = await db.workflowTask.findUnique({ where: { id }, select: { id: true } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const attachments = await db.taskAttachment.findMany({
      where: { taskId: id },
      include: { uploadedBy: { select: { id: true, name: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(serialise({ attachments }));
  } catch (error) {
    logger.error("Failed to list task attachments", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/workflows/tasks/[id]/attachments — upload file (multipart/form-data) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const task = await db.workflowTask.findUnique({ where: { id }, select: { id: true, instanceId: true } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds 25 MB limit" }, { status: 413 });
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const ext = path.extname(file.name).toLowerCase();
    const storedName = `${randomUUID()}${ext}`;
    const storagePath = path.join("task-attachments", storedName);
    const fullPath = path.join(UPLOAD_DIR, storedName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(fullPath, buffer);

    const attachment = await db.taskAttachment.create({
      data: {
        taskId: id,
        uploadedById: session.user.id,
        fileName: file.name,
        storagePath,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      },
      include: { uploadedBy: { select: { id: true, name: true, displayName: true } } },
    });

    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_ATTACHMENT_ADDED",
        actorId: session.user.id,
        data: { taskId: id, attachmentId: attachment.id, fileName: file.name } as object,
      },
    });

    return NextResponse.json(serialise({ attachment }), { status: 201 });
  } catch (error) {
    logger.error("Failed to upload task attachment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
