import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * POST /api/workflows/[id]/cancel
 * Cancel a running workflow instance.
 * Body: { reason: string }
 * Only the initiator or an admin can cancel.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { reason } = body as { reason: string };

    if (!reason) {
      return NextResponse.json(
        { error: "Reason is required" },
        { status: 400 }
      );
    }

    // Fetch the workflow instance with its tasks
    const instance = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            assignee: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!instance) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Only the initiator or an admin can cancel
    const isInitiator = instance.initiatedById === session.user.id;
    const isAdmin = (session.user.roles as string[])?.includes("admin");

    if (!isInitiator && !isAdmin) {
      return NextResponse.json(
        { error: "Only the initiator or an admin can cancel this workflow" },
        { status: 403 }
      );
    }

    // Only active workflows can be cancelled
    if (instance.status === "COMPLETED" || instance.status === "CANCELLED" || instance.status === "REJECTED") {
      return NextResponse.json(
        { error: `Cannot cancel a workflow with status: ${instance.status}` },
        { status: 400 }
      );
    }

    // Set workflow status to CANCELLED
    const updatedInstance = await db.workflowInstance.update({
      where: { id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
      },
      include: {
        template: { select: { id: true, name: true } },
        document: {
          select: { id: true, title: true, referenceNumber: true },
        },
      },
    });

    // Skip all PENDING tasks
    await db.workflowTask.updateMany({
      where: {
        instanceId: id,
        status: "PENDING",
      },
      data: { status: "SKIPPED" },
    });

    // Create workflow event
    await db.workflowEvent.create({
      data: {
        instanceId: id,
        eventType: "WORKFLOW_CANCELLED",
        actorId: session.user.id,
        data: {
          reason,
          cancelledBy: session.user.id,
        },
      },
    });

    // Collect all unique involved users (assignees + initiator)
    const involvedUserIds = new Set<string>();
    involvedUserIds.add(instance.initiatedById);
    for (const task of instance.tasks) {
      involvedUserIds.add(task.assigneeId);
    }
    // Don't notify the user who performed the cancellation
    involvedUserIds.delete(session.user.id);

    // Create notifications for all involved users
    if (involvedUserIds.size > 0) {
      await db.notification.createMany({
        data: Array.from(involvedUserIds).map((userId) => ({
          userId,
          type: "WORKFLOW_CANCELLED",
          title: "Workflow cancelled",
          body: `Workflow "${instance.subject}" has been cancelled. Reason: ${reason}`,
          linkUrl: "/workflows",
        })),
      });
    }

    // Write audit log
    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_CANCELLED",
      resourceType: "workflow_instance",
      resourceId: id,
      metadata: {
        subject: instance.subject,
        reason,
      },
    });

    return NextResponse.json(serialise({ workflow: updatedInstance }));
  } catch (error) {
    logger.error("Failed to cancel workflow", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
