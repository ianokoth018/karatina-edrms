import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * POST /api/workflows/tasks/[id]/claim
 * Claim an unclaimed pool task. Only pool members may claim.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const task = await db.workflowTask.findUnique({
      where: { id },
      include: { pool: { include: { members: { select: { userId: true } } } } },
    });

    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!task.poolId) return NextResponse.json({ error: "Task is not a pool task" }, { status: 400 });
    if (task.claimedById) return NextResponse.json({ error: "Task already claimed" }, { status: 409 });
    if (task.status !== "PENDING") return NextResponse.json({ error: "Task is not pending" }, { status: 400 });

    const isMember = task.pool?.members.some((m) => m.userId === session.user.id);
    const isAdmin = session.user.permissions.includes("workflows:manage") || session.user.roles.includes("Admin");
    if (!isMember && !isAdmin) {
      return NextResponse.json({ error: "You are not a member of this pool" }, { status: 403 });
    }

    const updated = await db.workflowTask.update({
      where: { id },
      data: {
        assigneeId: session.user.id,
        claimedById: session.user.id,
        claimedAt: new Date(),
      },
    });

    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_CLAIMED",
        actorId: session.user.id,
        data: { taskId: id, poolId: task.poolId, stepName: task.stepName } as object,
      },
    });

    logger.info("Pool task claimed", { taskId: id, claimedBy: session.user.id });
    return NextResponse.json({ task: updated });
  } catch (error) {
    logger.error("Failed to claim pool task", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
