import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { advanceWorkflow } from "@/lib/workflow-engine";
import { logger } from "@/lib/logger";

/**
 * POST /api/workflows/tasks/[id]/force-advance
 * Admin-only: immediately complete a task and advance the workflow.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = (body.action as "APPROVED" | "REJECTED") ?? "APPROVED";
    const comment = (body.comment as string) || `Force-advanced by admin ${session.user.name ?? session.user.email}`;

    const task = await db.workflowTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (task.status !== "PENDING") {
      return NextResponse.json({ error: "Task is not pending" }, { status: 400 });
    }

    const result = await advanceWorkflow({
      instanceId: task.instanceId,
      completedTaskId: id,
      action,
      actorId: session.user.id,
      comment,
    });

    await db.workflowEvent.create({
      data: {
        instanceId: task.instanceId,
        eventType: "TASK_FORCE_ADVANCED",
        actorId: session.user.id,
        data: { taskId: id, action, comment } as object,
      },
    });

    logger.info("Admin force-advanced task", { taskId: id, adminId: session.user.id, action });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error("Failed to force-advance task", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
