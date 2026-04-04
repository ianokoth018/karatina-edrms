import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  checkAndEscalateOverdueTasks,
  calculateSlaStatus,
} from "@/lib/workflow-sla";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

// ---------------------------------------------------------------------------
// GET /api/workflows/sla
// Returns SLA status for every pending workflow task.
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pendingTasks = await db.workflowTask.findMany({
      where: { status: "PENDING" },
      include: {
        assignee: {
          select: { id: true, name: true, displayName: true, email: true },
        },
        instance: {
          select: {
            id: true,
            referenceNumber: true,
            subject: true,
            template: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { assignedAt: "asc" },
    });

    const tasks = pendingTasks.map((task) => {
      const slaStatus = calculateSlaStatus({
        assignedAt: task.assignedAt,
        dueAt: task.dueAt,
      });

      const hoursRemaining = task.dueAt
        ? Math.max(
            0,
            (task.dueAt.getTime() - Date.now()) / (1000 * 60 * 60)
          )
        : null;

      return {
        taskId: task.id,
        stepName: task.stepName,
        stepIndex: task.stepIndex,
        assignee: task.assignee,
        assignedAt: task.assignedAt,
        dueAt: task.dueAt,
        slaStatus,
        hoursRemaining:
          hoursRemaining !== null
            ? Math.round(hoursRemaining * 100) / 100
            : null,
        instance: {
          id: task.instance.id,
          referenceNumber: task.instance.referenceNumber,
          subject: task.instance.subject,
          templateName: task.instance.template.name,
        },
      };
    });

    return NextResponse.json(serialise({ tasks, total: tasks.length }));
  } catch (error) {
    logger.error("Failed to fetch SLA statuses", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/workflows/sla
// Triggers the SLA check and escalation routine.
// ---------------------------------------------------------------------------

export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins or users with workflow:manage permission can trigger SLA checks
    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");

    if (!hasPermission) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await checkAndEscalateOverdueTasks();

    logger.info("SLA check completed", {
      userId: session.user.id,
      action: "SLA_CHECK_RUN",
    });

    return NextResponse.json({
      message: "SLA check completed",
      ...result,
    });
  } catch (error) {
    logger.error("SLA check failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
