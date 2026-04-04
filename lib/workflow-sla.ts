import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlaStatus = "on_track" | "at_risk" | "breached";

interface TaskNodeConfig {
  escalationDays?: number;
  reminderDays?: number;
  escalateTo?: string; // userId or role name
}

interface DefinitionNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Calculate SLA status for a single task
// ---------------------------------------------------------------------------

/**
 * Determine whether a task is on track, at risk, or has breached its SLA.
 *
 * - **breached**: past the due date (or past slaHours if provided).
 * - **at_risk**: within 25 % of the remaining window before due/slaHours.
 * - **on_track**: otherwise.
 */
export function calculateSlaStatus(task: {
  assignedAt: Date;
  dueAt: Date | null;
  slaHours?: number;
}): SlaStatus {
  const now = new Date();

  // Resolve the effective deadline
  let deadline: Date | null = task.dueAt;

  if (task.slaHours && task.slaHours > 0) {
    const slaDeadline = new Date(
      task.assignedAt.getTime() + task.slaHours * 60 * 60 * 1000
    );
    // Use the earlier of dueAt and slaHours deadline
    if (!deadline || slaDeadline < deadline) {
      deadline = slaDeadline;
    }
  }

  if (!deadline) {
    // No deadline information -- assume on track
    return "on_track";
  }

  if (now >= deadline) {
    return "breached";
  }

  // At-risk threshold: 25 % of total window remaining
  const totalMs = deadline.getTime() - task.assignedAt.getTime();
  const remainingMs = deadline.getTime() - now.getTime();

  if (totalMs > 0 && remainingMs / totalMs <= 0.25) {
    return "at_risk";
  }

  return "on_track";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract task-node configuration from a workflow template definition by
 * matching on the step name. Returns escalation / reminder settings.
 */
function getNodeConfigForStep(
  definition: Record<string, unknown>,
  stepName: string
): TaskNodeConfig {
  const nodes = definition.nodes as DefinitionNode[] | undefined;
  if (!nodes) return {};

  const node = nodes.find(
    (n) => n.type === "task" && (n.data.label as string) === stepName
  );

  if (!node) return {};

  return {
    escalationDays: (node.data.escalationDays as number) || undefined,
    reminderDays: (node.data.reminderDays as number) || undefined,
    escalateTo: (node.data.escalateTo as string) || undefined,
  };
}

/**
 * Return the number of full days elapsed since a given date.
 */
function daysElapsed(since: Date): number {
  return (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Main SLA check + escalation routine
// ---------------------------------------------------------------------------

export async function checkAndEscalateOverdueTasks(): Promise<{
  checked: number;
  escalated: number;
  reminded: number;
}> {
  let checked = 0;
  let escalated = 0;
  let reminded = 0;

  // 1. Fetch all PENDING tasks with their instance and template
  const pendingTasks = await db.workflowTask.findMany({
    where: { status: "PENDING" },
    include: {
      instance: {
        include: {
          template: { select: { id: true, definition: true } },
        },
      },
      assignee: { select: { id: true, name: true, displayName: true } },
    },
  });

  checked = pendingTasks.length;

  for (const task of pendingTasks) {
    const definition = task.instance.template.definition as Record<
      string,
      unknown
    >;

    // 2. Look up escalation config from the template definition
    const config = getNodeConfigForStep(definition, task.stepName);
    const elapsed = daysElapsed(task.assignedAt);

    // ------------------------------------------------------------------
    // 3. Escalation
    // ------------------------------------------------------------------
    if (config.escalationDays && config.escalationDays > 0 && elapsed >= config.escalationDays) {
      // Resolve the escalation target
      let escalationUserId: string | null = null;

      if (config.escalateTo) {
        // Try as a direct userId first
        const userById = await db.user.findUnique({
          where: { id: config.escalateTo },
          select: { id: true },
        });
        if (userById) {
          escalationUserId = userById.id;
        } else {
          // Try as a role name -- pick the first active user with that role
          const userRole = await db.userRole.findFirst({
            where: {
              role: { name: config.escalateTo },
              user: { isActive: true },
            },
            include: { user: { select: { id: true } } },
          });
          if (userRole) {
            escalationUserId = userRole.user.id;
          }
        }
      }

      // Fallback: find any user with the "Admin" role
      if (!escalationUserId) {
        const adminRole = await db.userRole.findFirst({
          where: {
            role: { name: "Admin" },
            user: { isActive: true },
          },
          include: { user: { select: { id: true } } },
        });
        escalationUserId = adminRole?.user.id ?? null;
      }

      // If still no target, fall back to the original assignee (log a warning)
      if (!escalationUserId) {
        logger.warn("SLA escalation: no escalation target found, skipping", {
          action: "SLA_ESCALATION_NO_TARGET",
        });
        continue;
      }

      // Create a new escalation task
      await db.workflowTask.create({
        data: {
          instanceId: task.instanceId,
          stepName: `[ESCALATED] ${task.stepName}`,
          stepIndex: task.stepIndex,
          assigneeId: escalationUserId,
          taskType: "PRIMARY",
          status: "PENDING",
          dueAt: task.dueAt,
        },
      });

      // Mark original task as ESCALATED
      await db.workflowTask.update({
        where: { id: task.id },
        data: { status: "ESCALATED" },
      });

      // Record a workflow event
      await db.workflowEvent.create({
        data: {
          instanceId: task.instanceId,
          eventType: "TASK_ESCALATED",
          actorId: null, // system action
          data: {
            originalTaskId: task.id,
            originalAssigneeId: task.assigneeId,
            escalatedToUserId: escalationUserId,
            stepName: task.stepName,
            daysOverdue: Math.floor(elapsed),
          },
        },
      });

      // Notify the escalation target
      await db.notification.create({
        data: {
          userId: escalationUserId,
          type: "SLA_ESCALATION",
          title: "Task escalated to you",
          body: `The task "${task.stepName}" for workflow "${task.instance.subject}" has been escalated to you after ${Math.floor(elapsed)} day(s) without action.`,
          linkUrl: `/workflows`,
        },
      });

      // Also notify the original assignee
      await db.notification.create({
        data: {
          userId: task.assigneeId,
          type: "SLA_ESCALATION",
          title: "Your task has been escalated",
          body: `The task "${task.stepName}" for workflow "${task.instance.subject}" has been escalated after ${Math.floor(elapsed)} day(s) without action.`,
          linkUrl: `/workflows`,
        },
      });

      escalated++;
      logger.info("SLA escalation triggered", {
        action: "SLA_ESCALATED",
      });

      // Skip reminder check -- we already escalated
      continue;
    }

    // ------------------------------------------------------------------
    // 4. Reminder (before escalation threshold)
    // ------------------------------------------------------------------
    if (config.reminderDays && config.reminderDays > 0 && elapsed >= config.reminderDays) {
      // Avoid spamming: only send a reminder once per day by checking
      // for an existing SLA_REMINDER notification created today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const existingReminder = await db.notification.findFirst({
        where: {
          userId: task.assigneeId,
          type: "SLA_REMINDER",
          createdAt: { gte: todayStart },
          body: { contains: task.id },
        },
      });

      if (!existingReminder) {
        await db.notification.create({
          data: {
            userId: task.assigneeId,
            type: "SLA_REMINDER",
            title: "Task reminder",
            body: `Reminder: your task "${task.stepName}" for workflow "${task.instance.subject}" has been pending for ${Math.floor(elapsed)} day(s). [${task.id}]`,
            linkUrl: `/workflows`,
          },
        });

        reminded++;
        logger.info("SLA reminder sent", {
          action: "SLA_REMINDER",
        });
      }
    }
  }

  return { checked, escalated, reminded };
}
