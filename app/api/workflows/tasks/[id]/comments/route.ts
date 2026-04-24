import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/** GET /api/workflows/tasks/[id]/comments — list threaded comments */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const task = await db.workflowTask.findUnique({ where: { id }, select: { id: true, instanceId: true } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const comments = await db.taskComment.findMany({
      where: { taskId: id },
      include: {
        author: { select: { id: true, name: true, displayName: true, email: true } },
        replies: {
          include: {
            author: { select: { id: true, name: true, displayName: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Return only root-level comments (parentId null); replies are nested
    const roots = comments.filter((c) => !c.parentId);
    return NextResponse.json(serialise({ comments: roots }));
  } catch (error) {
    logger.error("Failed to list task comments", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/workflows/tasks/[id]/comments — create comment (optionally threaded) */
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

    const body = await req.json();
    const { body: text, parentId } = body as { body: string; parentId?: string };

    if (!text?.trim()) return NextResponse.json({ error: "Comment body is required" }, { status: 400 });

    if (parentId) {
      const parent = await db.taskComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.taskId !== id) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
      }
    }

    const comment = await db.taskComment.create({
      data: {
        taskId: id,
        authorId: session.user.id,
        body: text.trim(),
        parentId: parentId ?? null,
      },
      include: {
        author: { select: { id: true, name: true, displayName: true, email: true } },
      },
    });

    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_COMMENTED",
        actorId: session.user.id,
        data: { taskId: id, commentId: comment.id, isReply: !!parentId } as object,
      },
    });

    return NextResponse.json(serialise({ comment }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create task comment", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
