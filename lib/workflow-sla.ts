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
  // Deadline
  deadlineType?: string;
  deadlineNotifyBefore?: boolean;
  deadlineNotifyBeforeValue?: number;
  deadlineNotifyBeforeUnit?: string;
  deadlineNotifyOverdue?: boolean;
  deadlineNotifyOverdueRole?: string;
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

  // Deadline notification config (common to all nodes)
  const deadlineConfig: Pick<TaskNodeConfig, "deadlineType" | "deadlineNotifyBefore" | "deadlineNotifyBeforeValue" | "deadlineNotifyBeforeUnit" | "deadlineNotifyOverdue" | "deadlineNotifyOverdueRole"> = {
    deadlineType: (node.data.deadlineType as string) || "none",
    deadlineNotifyBefore: !!(node.data.deadlineNotifyBefore),
    deadlineNotifyBeforeValue: (node.data.deadlineNotifyBeforeValue as number) || 1,
    deadlineNotifyBeforeUnit: (node.data.deadlineNotifyBeforeUnit as string) || "days",
    deadlineNotifyOverdue: !!(node.data.deadlineNotifyOverdue),
    deadlineNotifyOverdueRole: (node.data.deadlineNotifyOverdueRole as string) || "",
  };

  // Multi-level escalation config
  const levels = node.data.escalationLevels as EscalationLevel[] | undefined;
  if (levels?.length) {
    return { escalationLevels: levels, ...deadlineConfig };
  }

  // Legacy single-level — read both field names for compatibility
  const escalateTo = (node.data.escalateTo as string) || (node.data.escalationTo as string) || undefined;
  return {
    escalationDays: (node.data.escalationDays as number) || undefined,
    reminderDays: (node.data.reminderDays as number) || undefined,
    escalateTo,
    ...deadlineConfig,
  };
}

function daysElapsed(since: Date): number {
  return (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
}

async function resolveEscalationUser(assigneeRule?: string, assigneeValue?: string): Promise<string | null> {
  if (!assigneeValue) return null;

  // Handle prefixed values: "user:<id>", "role:<name>", "pool:<id>", "department:<dept>"
  if (assigneeValue.startsWith("user:")) {
    const userId = assigneeValue.slice(5);
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user?.id ?? null;
  }
  if (assigneeValue.startsWith("role:")) {
    const roleName = assigneeValue.slice(5);
    const byRole = await db.userRole.findFirst({
      where: { role: { name: roleName }, user: { isActive: true } },
      include: { user: { select: { id: true } } },
    });
    return byRole?.user.id ?? null;
  }
  if (assigneeValue.startsWith("pool:")) {
    const poolId = assigneeValue.slice(5);
    const member = await db.workflowPoolMember.findFirst({
      where: { poolId, user: { isActive: true } },
      include: { user: { select: { id: true } } },
    });
    return member?.user.id ?? null;
  }
  if (assigneeValue.startsWith("department:")) {
    const dept = assigneeValue.slice(11);
    const user = await db.user.findFirst({
      where: { department: dept, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

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

    // ------------------------------------------------------------------
    // Deadline notifications (approaching + overdue)
    // ------------------------------------------------------------------
    if (!task.dueAt || config.deadlineType === "none") continue;

    const now = new Date();
    const msUntilDeadline = task.dueAt.getTime() - now.getTime();
    const isOverdue = msUntilDeadline <= 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Approaching deadline reminder
    if (
      !isOverdue &&
      config.deadlineNotifyBefore &&
      task.assigneeId
    ) {
      const notifyBeforeMs = config.deadlineNotifyBeforeUnit === "hours"
        ? (config.deadlineNotifyBeforeValue ?? 1) * 3600000
        : (config.deadlineNotifyBeforeValue ?? 1) * 86400000;

      if (msUntilDeadline <= notifyBeforeMs) {
        const alreadyNotified = await db.notification.findFirst({
          where: {
            userId: task.assigneeId,
            type: "DEADLINE_APPROACHING",
            createdAt: { gte: todayStart },
            body: { contains: task.id },
          },
        });
        if (!alreadyNotified) {
          const hoursLeft = Math.ceil(msUntilDeadline / 3600000);
          const timeLabel = hoursLeft >= 24 ? `${Math.ceil(hoursLeft / 24)} day(s)` : `${hoursLeft} hour(s)`;
          await db.notification.create({
            data: {
              userId: task.assigneeId,
              type: "DEADLINE_APPROACHING",
              title: "Deadline approaching",
              body: `"${task.stepName}" for "${task.instance.subject}" is due in ${timeLabel}. [${task.id}]`,
              linkUrl: "/workflows",
            },
          });
          reminded++;
        }
      }
    }

    // Overdue notification
    if (isOverdue && config.deadlineNotifyOverdue) {
      const hoursOverdue = Math.ceil(Math.abs(msUntilDeadline) / 3600000);

      // Notify assignee
      if (task.assigneeId) {
        const alreadyNotified = await db.notification.findFirst({
          where: {
            userId: task.assigneeId,
            type: "DEADLINE_MISSED",
            createdAt: { gte: todayStart },
            body: { contains: task.id },
          },
        });
        if (!alreadyNotified) {
          await db.notification.create({
            data: {
              userId: task.assigneeId,
              type: "DEADLINE_MISSED",
              title: "Task deadline missed",
              body: `"${task.stepName}" for "${task.instance.subject}" is ${hoursOverdue} hour(s) overdue. [${task.id}]`,
              linkUrl: "/workflows",
            },
          });
        }
      }

      // Notify overdue role if configured
      if (config.deadlineNotifyOverdueRole) {
        const roleUser = await resolveEscalationUser(undefined, config.deadlineNotifyOverdueRole);
        if (roleUser) {
          const alreadyNotified = await db.notification.findFirst({
            where: {
              userId: roleUser,
              type: "DEADLINE_MISSED",
              createdAt: { gte: todayStart },
              body: { contains: task.id },
            },
          });
          if (!alreadyNotified) {
            await db.notification.create({
              data: {
                userId: roleUser,
                type: "DEADLINE_MISSED",
                title: "Workflow task overdue",
                body: `"${task.stepName}" for "${task.instance.subject}" missed its deadline by ${hoursOverdue} hour(s). Assignee: ${task.assignee?.displayName ?? task.assignee?.name ?? "unassigned"}. [${task.id}]`,
                linkUrl: "/workflows",
              },
            });
          }
        }
      }
    }
  }

  return { checked, escalated, reminded };
}
