import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getDefaultCalendar, workingHoursBetween } from "@/lib/business-calendar";
import { sendSms, buildSlaSms } from "@/lib/sms";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlaStatus = "on_track" | "at_risk" | "breached";

interface EscalationLevel {
  afterDays: number;
  assigneeRule?: string; // "specific_user" | "role_based"
  assigneeValue?: string; // userId or role name
}

interface TaskNodeConfig {
  escalationLevels?: EscalationLevel[];
  // Legacy single-level config (still supported)
  escalationDays?: number;
  reminderDays?: number;
  escalateTo?: string;
}

interface DefinitionNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SLA status for a single task
// ---------------------------------------------------------------------------

export function calculateSlaStatus(task: {
  assignedAt: Date;
  dueAt: Date | null;
}): SlaStatus {
  const now = new Date();
  const deadline = task.dueAt;

  if (!deadline) return "on_track";
  if (now >= deadline) return "breached";

  const totalMs = deadline.getTime() - task.assignedAt.getTime();
  const remainingMs = deadline.getTime() - now.getTime();

  if (totalMs > 0 && remainingMs / totalMs <= 0.25) return "at_risk";
  return "on_track";
}

/**
 * Calendar-aware SLA status: uses working hours instead of wall-clock hours.
 * Falls back to the simpler calculateSlaStatus if no calendar is configured.
 */
export async function calculateSlaStatusAsync(task: {
  assignedAt: Date;
  dueAt: Date | null;
}): Promise<SlaStatus> {
  if (!task.dueAt) return "on_track";
  const now = new Date();
  if (now >= task.dueAt) return "breached";

  try {
    const cal = await getDefaultCalendar();
    const totalWorkingHours = workingHoursBetween(task.assignedAt, task.dueAt, cal);
    const remainingWorkingHours = workingHoursBetween(now, task.dueAt, cal);

    if (totalWorkingHours > 0 && remainingWorkingHours / totalWorkingHours <= 0.25) return "at_risk";
    return "on_track";
  } catch {
    return calculateSlaStatus(task);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeConfigForStep(
  definition: Record<string, unknown>,
  stepName: string,
  nodeId?: string | null
): TaskNodeConfig {
  const nodes = definition.nodes as DefinitionNode[] | undefined;
  if (!nodes) return {};

  // Prefer nodeId match, fall back to label
  const node = nodes.find((n) => {
    if (n.type !== "task") return false;
    if (nodeId && n.id === nodeId) return true;
    return (n.data.label as string) === stepName;
  });

  if (!node) return {};

  // Multi-level escalation config
  const levels = node.data.escalationLevels as EscalationLevel[] | undefined;
  if (levels?.length) {
    return { escalationLevels: levels };
  }

  // Legacy single-level
  return {
    escalationDays: (node.data.escalationDays as number) || undefined,
    reminderDays: (node.data.reminderDays as number) || undefined,
    escalateTo: (node.data.escalateTo as string) || undefined,
  };
}

function daysElapsed(since: Date): number {
  return (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
}

async function resolveEscalationUser(assigneeRule?: string, assigneeValue?: string): Promise<string | null> {
  if (!assigneeValue) return null;

  if (assigneeRule === "specific_user") {
    const user = await db.user.findUnique({ where: { id: assigneeValue }, select: { id: true } });
    return user?.id ?? null;
  }

  // role_based or no rule — try as userId first, then role name
  const byId = await db.user.findUnique({ where: { id: assigneeValue }, select: { id: true } });
  if (byId) return byId.id;

  const byRole = await db.userRole.findFirst({
    where: { role: { name: assigneeValue }, user: { isActive: true } },
    include: { user: { select: { id: true } } },
  });
  return byRole?.user.id ?? null;
}

async function getAdminUserId(): Promise<string | null> {
  const adminRole = await db.userRole.findFirst({
    where: { role: { name: "Admin" }, user: { isActive: true } },
    include: { user: { select: { id: true } } },
  });
  return adminRole?.user.id ?? null;
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
    const definition = task.instance.template.definition as Record<string, unknown>;
    const config = getNodeConfigForStep(definition, task.stepName, task.nodeId);
    const elapsed = daysElapsed(task.assignedAt);

    // ------------------------------------------------------------------
    // Multi-level escalation
    // ------------------------------------------------------------------
    if (config.escalationLevels?.length) {
      const levels = config.escalationLevels.sort((a, b) => a.afterDays - b.afterDays);

      // Find the highest level whose threshold has been crossed
      const triggeredLevel = [...levels].reverse().find((l) => elapsed >= l.afterDays);

      if (triggeredLevel) {
        const levelIndex = levels.indexOf(triggeredLevel);

        // Only escalate if we haven't already reached this level
        if (task.escalationLevel <= levelIndex && !task.escalatedAt) {
          let escalationUserId = await resolveEscalationUser(
            triggeredLevel.assigneeRule, triggeredLevel.assigneeValue
          );
          if (!escalationUserId) escalationUserId = await getAdminUserId();
          if (!escalationUserId) {
            logger.warn("SLA multi-level escalation: no target found", { taskId: task.id });
            continue;
          }

          await db.$transaction([
            db.workflowTask.create({
              data: {
                instanceId: task.instanceId,
                nodeId: task.nodeId,
                stepName: `[L${levelIndex + 1} ESCALATED] ${task.stepName}`,
                stepIndex: task.stepIndex,
                assigneeId: escalationUserId,
                taskType: "PRIMARY",
                status: "PENDING",
                dueAt: task.dueAt,
                escalationLevel: levelIndex + 1,
              },
            }),
            db.workflowTask.update({
              where: { id: task.id },
              data: { status: "ESCALATED", escalatedAt: new Date(), escalationLevel: levelIndex + 1 },
            }),
            db.workflowEvent.create({
              data: {
                instanceId: task.instanceId,
                eventType: "TASK_ESCALATED",
                data: {
                  originalTaskId: task.id,
                  originalAssigneeId: task.assigneeId,
                  escalatedToUserId: escalationUserId,
                  escalationLevel: levelIndex + 1,
                  daysOverdue: Math.floor(elapsed),
                } as object,
              },
            }),
          ]);

          await db.notification.createMany({
            data: [
              {
                userId: escalationUserId,
                type: "SLA_ESCALATION",
                title: `Task escalated to you (Level ${levelIndex + 1})`,
                body: `Task "${task.stepName}" for "${task.instance.subject}" escalated after ${Math.floor(elapsed)} day(s).`,
                linkUrl: "/workflows",
              },
              ...(task.assigneeId
                ? [
                    {
                      userId: task.assigneeId,
                      type: "SLA_ESCALATION",
                      title: "Your task has been escalated",
                      body: `Task "${task.stepName}" for "${task.instance.subject}" was escalated (Level ${levelIndex + 1}) after ${Math.floor(elapsed)} day(s).`,
                      linkUrl: "/workflows",
                    },
                  ]
                : []),
            ],
          });

          // SMS escalation alerts
          const [escUser, origUser] = await Promise.all([
            db.user.findUnique({ where: { id: escalationUserId }, select: { phone: true, name: true, displayName: true } }),
            task.assigneeId ? db.user.findUnique({ where: { id: task.assigneeId }, select: { phone: true, name: true, displayName: true } }) : null,
          ]);
          if (escUser?.phone) {
            await sendSms({ to: escUser.phone, message: buildSlaSms({ recipientName: escUser.displayName ?? escUser.name ?? "User", stepName: task.stepName, instanceRef: task.instanceId, hoursOverdue: elapsed * 24 }) });
          }
          if (origUser?.phone) {
            await sendSms({ to: origUser.phone, message: buildSlaSms({ recipientName: origUser.displayName ?? origUser.name ?? "User", stepName: task.stepName, instanceRef: task.instanceId, hoursOverdue: elapsed * 24 }) });
          }

          escalated++;
          continue;
        }
      }
    } else if (config.escalationDays && config.escalationDays > 0 && elapsed >= config.escalationDays) {
      // ------------------------------------------------------------------
      // Legacy single-level escalation — only if not already escalated
      // ------------------------------------------------------------------
      if (task.escalatedAt) continue;

      let escalationUserId = await resolveEscalationUser(undefined, config.escalateTo);
      if (!escalationUserId) escalationUserId = await getAdminUserId();
      if (!escalationUserId) {
        logger.warn("SLA escalation: no target found", { taskId: task.id });
        continue;
      }

      await db.$transaction([
        db.workflowTask.create({
          data: {
            instanceId: task.instanceId,
            nodeId: task.nodeId,
            stepName: `[ESCALATED] ${task.stepName}`,
            stepIndex: task.stepIndex,
            assigneeId: escalationUserId,
            taskType: "PRIMARY",
            status: "PENDING",
            dueAt: task.dueAt,
          },
        }),
        db.workflowTask.update({
          where: { id: task.id },
          data: { status: "ESCALATED", escalatedAt: new Date() },
        }),
        db.workflowEvent.create({
          data: {
            instanceId: task.instanceId,
            eventType: "TASK_ESCALATED",
            data: {
              originalTaskId: task.id,
              originalAssigneeId: task.assigneeId,
              escalatedToUserId: escalationUserId,
              daysOverdue: Math.floor(elapsed),
            } as object,
          },
        }),
      ]);

      await db.notification.createMany({
        data: [
          {
            userId: escalationUserId,
            type: "SLA_ESCALATION",
            title: "Task escalated to you",
            body: `Task "${task.stepName}" for "${task.instance.subject}" escalated after ${Math.floor(elapsed)} day(s).`,
            linkUrl: "/workflows",
          },
          ...(task.assigneeId
            ? [
                {
                  userId: task.assigneeId,
                  type: "SLA_ESCALATION",
                  title: "Your task has been escalated",
                  body: `Task "${task.stepName}" for "${task.instance.subject}" was escalated after ${Math.floor(elapsed)} day(s).`,
                  linkUrl: "/workflows",
                },
              ]
            : []),
        ],
      });

      // SMS escalation alerts
      const [escUserL, origUserL] = await Promise.all([
        db.user.findUnique({ where: { id: escalationUserId }, select: { phone: true, name: true, displayName: true } }),
        task.assigneeId ? db.user.findUnique({ where: { id: task.assigneeId }, select: { phone: true, name: true, displayName: true } }) : null,
      ]);
      if (escUserL?.phone) {
        await sendSms({ to: escUserL.phone, message: buildSlaSms({ recipientName: escUserL.displayName ?? escUserL.name ?? "User", stepName: task.stepName, instanceRef: task.instanceId, hoursOverdue: elapsed * 24 }) });
      }
      if (origUserL?.phone) {
        await sendSms({ to: origUserL.phone, message: buildSlaSms({ recipientName: origUserL.displayName ?? origUserL.name ?? "User", stepName: task.stepName, instanceRef: task.instanceId, hoursOverdue: elapsed * 24 }) });
      }

      escalated++;
      continue;
    }

    // ------------------------------------------------------------------
    // Reminder (only if not yet escalated)
    // ------------------------------------------------------------------
    if (
      !task.escalatedAt &&
      config.reminderDays &&
      config.reminderDays > 0 &&
      elapsed >= config.reminderDays &&
      task.assigneeId
    ) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const alreadyReminded = await db.notification.findFirst({
        where: {
          userId: task.assigneeId,
          type: "SLA_REMINDER",
          createdAt: { gte: todayStart },
          body: { contains: task.id },
        },
      });

      if (!alreadyReminded) {
        await db.notification.create({
          data: {
            userId: task.assigneeId,
            type: "SLA_REMINDER",
            title: "Task reminder",
            body: `Reminder: "${task.stepName}" for "${task.instance.subject}" has been pending for ${Math.floor(elapsed)} day(s). [${task.id}]`,
            linkUrl: "/workflows",
          },
        });
        reminded++;
      }
    }
  }

  return { checked, escalated, reminded };
}
