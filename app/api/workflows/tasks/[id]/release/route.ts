import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * POST /api/workflows/tasks/[id]/release
 * Release a claimed pool task back to the queue.
 * Only the claimer or an admin may release.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const task = await db.workflowTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!task.poolId) return NextResponse.json({ error: "Task is not a pool task" }, { status: 400 });
    if (!task.claimedById) return NextResponse.json({ error: "Task is not claimed" }, { status: 400 });

    const isAdmin = session.user.permissions.includes("workflows:manage") || session.user.roles.includes("Admin");
    if (task.claimedById !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "Only the claimer or an admin can release this task" }, { status: 403 });
    }

    const updated = await db.workflowTask.update({
      where: { id },
      data: { assigneeId: null, claimedById: null, claimedAt: null },
    });

    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_RELEASED",
        actorId: session.user.id,
        data: { taskId: id, poolId: task.poolId, stepName: task.stepName } as object,
      },
    });

    return NextResponse.json({ task: updated });
  } catch (error) {
    logger.error("Failed to release pool task", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
