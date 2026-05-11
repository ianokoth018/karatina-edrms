// ---------------------------------------------------------------------------
// Escalation Engine
// ---------------------------------------------------------------------------
// Walks pending workflow tasks and fires escalation levels when the configured
// time threshold has elapsed. Called on a cron schedule or on-demand.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { sendSms, buildSlaSms } from "@/lib/sms";
import * as React from "react";
import WorkflowNotification from "@/emails/workflow-notification";

interface EscalationLevel {
  level: number;
  afterHours: number;
  action: "notify" | "reassign" | "both";
  escalateTo: string;   // "supervisor" | "user:{id}" | "role:{name}" | "department:{name}"
  notifyOriginal?: boolean;
  message?: string;
}

interface EscalationMatrix {
  id: string;
  name: string;
  userId: string | null;
  roleId: string | null;
  department: string | null;
  levels: EscalationLevel[];
}

// ---------------------------------------------------------------------------
// Resolve which escalation matrix applies to a given user
// ---------------------------------------------------------------------------

async function resolveMatrix(userId: string): Promise<EscalationMatrix | null> {
  // 1. Exact user match
  const byUser = await db.escalationMatrix.findFirst({
    where: { userId, isActive: true },
  });
  if (byUser) return { ...byUser, levels: byUser.levels as unknown as EscalationLevel[] };

  // 2. Role match — find the user's roles, check for a matrix on each
  const userRoles = await db.userRole.findMany({
    where: { userId },
    select: { roleId: true },
  });
  if (userRoles.length > 0) {
    const byRole = await db.escalationMatrix.findFirst({
      where: { roleId: { in: userRoles.map((r) => r.roleId) }, isActive: true },
    });
    if (byRole) return { ...byRole, levels: byRole.levels as unknown as EscalationLevel[] };
  }

  // 3. Department match
  const user = await db.user.findUnique({ where: { id: userId }, select: { department: true } });
  if (user?.department) {
    const byDept = await db.escalationMatrix.findFirst({
      where: { department: user.department, isActive: true },
    });
    if (byDept) return { ...byDept, levels: byDept.levels as unknown as EscalationLevel[] };
  }

  // 4. Global fallback (no userId, roleId, or department)
  const global = await db.escalationMatrix.findFirst({
    where: { userId: null, roleId: null, department: null, isActive: true },
  });
  if (global) return { ...global, levels: global.levels as unknown as EscalationLevel[] };

  return null;
}

// ---------------------------------------------------------------------------
// Resolve "escalateTo" string to a concrete user ID
// ---------------------------------------------------------------------------

async function resolveEscalateTo(
  escalateTo: string,
  originalAssigneeId: string
): Promise<string | null> {
  if (escalateTo === "supervisor") {
    // Find the department head for the original assignee
    const user = await db.user.findUnique({
      where: { id: originalAssigneeId },
      select: { department: true },
    });
    if (user?.department) {
      const head = await db.user.findFirst({
        where: {
          department: user.department,
          isActive: true,
          id: { not: originalAssigneeId },
          roles: {
            some: {
              role: { name: { in: ["Department Head", "HOD", "Head of Department", "Director"] } },
            },
          },
        },
        select: { id: true },
      });
      return head?.id ?? null;
    }
    return null;
  }

  if (escalateTo.startsWith("user:")) {
    return escalateTo.slice(5);
  }

  if (escalateTo.startsWith("role:")) {
    const roleName = escalateTo.slice(5);
    const ur = await db.userRole.findFirst({
      where: { role: { name: roleName }, user: { isActive: true } },
      select: { userId: true },
    });
    return ur?.userId ?? null;
  }

  if (escalateTo.startsWith("department:")) {
    const deptName = escalateTo.slice(11);
    const user = await db.user.findFirst({
      where: { department: deptName, isActive: true },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Send escalation notification
// ---------------------------------------------------------------------------

async function sendEscalationNotification(params: {
  userId: string;
  taskStepName: string;
  instanceSubject: string;
  instanceRef: string | null;
  message?: string;
  level: number;
  hoursOverdue?: number;
}): Promise<void> {
  const { userId, taskStepName, instanceSubject, instanceRef, message, level, hoursOverdue } = params;
  const title = `Escalation (Level ${level}): Action Required — ${taskStepName}`;
  const body = message || `Task "${taskStepName}" on "${instanceSubject}" has exceeded its SLA and has been escalated to you (Level ${level}).`;

  try {
    await db.notification.create({
      data: { userId, type: "WORKFLOW_TASK", title, body, linkUrl: "/workflows" },
    });

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, displayName: true, phone: true },
    });

    if (user?.email) {
      await sendMail({
        to: user.email,
        subject: title,
        react: React.createElement(WorkflowNotification, {
          recipientName: user.displayName ?? user.name ?? "User",
          subject: title,
          body,
        }),
      });
    }

    if (user?.phone) {
      await sendSms({
        to: user.phone,
        message: buildSlaSms({
          recipientName: user.displayName ?? user.name ?? "User",
          stepName: taskStepName,
          instanceRef: instanceRef ?? "unknown",
          hoursOverdue: hoursOverdue ?? 0,
        }),
      });
    }
  } catch (error) {
    logger.error("Failed to send escalation notification", error, { userId });
  }
}

// ---------------------------------------------------------------------------
// Main: check and fire escalations for all pending tasks
// ---------------------------------------------------------------------------

export interface EscalationRunResult {
  checked: number;
  escalated: number;
  errors: number;
}

export async function runEscalationCheck(): Promise<EscalationRunResult> {
  const result: EscalationRunResult = { checked: 0, escalated: 0, errors: 0 };
  const now = new Date();

  // Fetch all pending tasks that have an assignee
  const pendingTasks = await db.workflowTask.findMany({
    where: {
      status: "PENDING",
      assigneeId: { not: null },
    },
    include: {
      instance: { select: { id: true, subject: true, referenceNumber: true } },
      escalationLogs: true,
    },
    orderBy: { assignedAt: "asc" },
  });

  for (const task of pendingTasks) {
    result.checked++;
    try {
      if (!task.assigneeId) continue;

      const matrix = await resolveMatrix(task.assigneeId);
      if (!matrix || matrix.levels.length === 0) continue;

      // Sort levels ascending
      const sortedLevels = [...matrix.levels].sort((a, b) => a.level - b.level);
      const firedLevels = new Set(task.escalationLogs.map((l) => l.level));

      for (const lvl of sortedLevels) {
        if (firedLevels.has(lvl.level)) continue; // already fired

        // Check if enough time has passed since assignment
        const hoursElapsed = (now.getTime() - task.assignedAt.getTime()) / (1000 * 60 * 60);
        if (hoursElapsed < lvl.afterHours) continue;

        // Fire this escalation level
        const escalateToId = await resolveEscalateTo(lvl.escalateTo, task.assigneeId);
        const stepName = task.stepName;
        const subject = task.instance?.subject ?? "Workflow";
        const ref = task.instance?.referenceNumber ?? null;

        if (lvl.action === "notify" || lvl.action === "both") {
          // Notify the escalation target
          if (escalateToId) {
            await sendEscalationNotification({
              userId: escalateToId,
              taskStepName: stepName,
              instanceSubject: subject,
              instanceRef: ref,
              message: lvl.message,
              level: lvl.level,
              hoursOverdue: hoursElapsed,
            });
          }
          // Optionally remind the original assignee
          if (lvl.notifyOriginal) {
            await sendEscalationNotification({
              userId: task.assigneeId,
              taskStepName: stepName,
              instanceSubject: subject,
              instanceRef: ref,
              message: `Reminder: Task "${stepName}" is overdue and has been escalated (Level ${lvl.level}).`,
              level: lvl.level,
              hoursOverdue: hoursElapsed,
            });
          }
        }

        if ((lvl.action === "reassign" || lvl.action === "both") && escalateToId) {
          // Reassign the task
          await db.workflowTask.update({
            where: { id: task.id },
            data: {
              assigneeId: escalateToId,
              escalatedAt: now,
              escalationLevel: lvl.level,
            },
          });

          await db.workflowEvent.create({
            data: {
              instanceId: task.instanceId,
              eventType: "TASK_ESCALATED",
              data: {
                taskId: task.id,
                fromAssigneeId: task.assigneeId,
                toAssigneeId: escalateToId,
                level: lvl.level,
                matrixId: matrix.id,
              } as object,
            },
          });

          logger.info("Task escalated via matrix", {
            taskId: task.id,
            level: lvl.level,
            from: task.assigneeId,
            to: escalateToId,
          });
        }

        // Log that this level fired
        await db.taskEscalationLog.create({
          data: {
            taskId: task.id,
            matrixId: matrix.id,
            level: lvl.level,
            action: lvl.action,
            escalatedTo: escalateToId ?? undefined,
          },
        });

        result.escalated++;
        // Fire at most one new level per task per run
        break;
      }
    } catch (error) {
      logger.error("Escalation check failed for task", error, { taskId: task.id });
      result.errors++;
    }
  }

  logger.info("Escalation check complete", result as unknown as Record<string, unknown>);
  return result;
}
