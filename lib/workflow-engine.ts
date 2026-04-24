// ---------------------------------------------------------------------------
// Workflow Execution Engine
// ---------------------------------------------------------------------------
// Graph-based workflow engine supporting: decision gateways, parallel
// fork/join (all/any/quorum), timer nodes, email/system actions, subprocess
// instances, and flexible assignee resolution with delegation enforcement.
// ---------------------------------------------------------------------------

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail, interpolate } from "@/lib/mailer";
import * as React from "react";
import WorkflowActionRequired from "@/emails/workflow-action-required";
import WorkflowNotification from "@/emails/workflow-notification";
import { sendSms, buildTaskSms, buildSlaSms, buildCompletionSms } from "@/lib/sms";
import { getDefaultCalendar, addWorkingHours } from "@/lib/business-calendar";

// ========================== Type Definitions ===============================

interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [key: string]: unknown;
}

interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  steps?: unknown[];
}

interface Condition {
  field: string;
  operator: string;
  value: string;
  handleId: string;
}

interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: (Condition | ConditionGroup)[];
  handleId: string;
}

// ========================== Public API =====================================

/**
 * Bootstrap a newly created workflow instance by traversing from start
 * node(s) and creating the first task(s). Called once by POST /api/workflows
 * immediately after creating the instance record.
 *
 * Returns the IDs of tasks created in the first traversal wave.
 */
export async function bootstrapWorkflow(params: {
  instanceId: string;
  initiatorId: string;
  formData?: Record<string, unknown>;
}): Promise<{ createdTaskIds: string[]; workflowCompleted: boolean }> {
  const { instanceId, initiatorId, formData } = params;

  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { template: true },
  });
  if (!instance) throw new Error(`Workflow instance ${instanceId} not found`);

  const definition = instance.template.definition as unknown as WorkflowDefinition;
  if (!definition.nodes || !Array.isArray(definition.nodes)) {
    logger.warn("bootstrapWorkflow: no graph nodes — nothing to traverse", { instanceId });
    return { createdTaskIds: [], workflowCompleted: false };
  }

  if (formData && Object.keys(formData).length > 0) {
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { formData: formData as object },
    });
  }

  const workflowData: Record<string, unknown> = {
    ...((formData) ?? {}),
    _actor: initiatorId,
  };

  const startNodes = definition.nodes.filter((n) => n.type === "start");
  const createdTaskIds: string[] = [];
  let workflowCompleted = false;

  for (const startNode of startNodes) {
    await processNextNodes(
      definition, startNode.id, undefined,
      instanceId, initiatorId,
      workflowData, createdTaskIds,
      (v) => { workflowCompleted = v; },
      new Set()
    );
  }

  if (workflowCompleted) {
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  return { createdTaskIds, workflowCompleted };
}

/**
 * resumeSignal — called when an external signal is received.
 * Marks the signal as received, completes the placeholder task,
 * and resumes traversal from the wait_signal node.
 */
export async function resumeSignal(params: {
  signalKey: string;
  payload?: Record<string, unknown>;
  actorId: string;
}): Promise<{ resumed: boolean; nextTasks: string[] }> {
  const { signalKey, payload = {}, actorId } = params;

  const signal = await db.workflowSignal.findUnique({ where: { signalKey } });
  if (!signal) return { resumed: false, nextTasks: [] };
  if (signal.receivedAt) return { resumed: true, nextTasks: [] }; // already handled

  await db.workflowSignal.update({
    where: { signalKey },
    data: {
      receivedAt: new Date(),
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  if (signal.taskId) {
    await db.workflowTask.update({
      where: { id: signal.taskId },
      data: { status: "COMPLETED", action: "APPROVED", completedAt: new Date() },
    });
  }

  await db.workflowEvent.create({
    data: {
      instanceId: signal.instanceId,
      eventType: "SIGNAL_RECEIVED",
      actorId,
      data: { signalKey, nodeId: signal.nodeId, payload } as object,
    },
  });

  // Continue traversal from the wait_signal node
  const instance = await db.workflowInstance.findUnique({
    where: { id: signal.instanceId },
    include: { template: true },
  });
  if (!instance) return { resumed: false, nextTasks: [] };

  const definition = instance.template.definition as unknown as WorkflowDefinition;
  const createdTaskIds: string[] = [];
  let workflowCompleted = false;

  await processNextNodes(
    definition,
    signal.nodeId,
    undefined,
    signal.instanceId,
    actorId,
    payload,
    createdTaskIds,
    (v) => { workflowCompleted = v; },
    new Set()
  );

  if (workflowCompleted) {
    await db.workflowInstance.update({
      where: { id: signal.instanceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  return { resumed: true, nextTasks: createdTaskIds };
}

export async function advanceWorkflow(params: {
  instanceId: string;
  completedTaskId: string;
  action: "APPROVED" | "REJECTED" | "RETURNED";
  actorId: string;
  comment?: string;
  formData?: Record<string, unknown>;
}): Promise<{
  nextTasks: string[];
  workflowCompleted: boolean;
  workflowRejected: boolean;
}> {
  const { instanceId, completedTaskId, action, actorId, comment, formData } = params;

  // --- Optimistic concurrency lock ---
  // Read current version, then try to increment it atomically.
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { template: true },
  });

  if (!instance) throw new Error(`Workflow instance ${instanceId} not found`);

  const locked = await db.workflowInstance.updateMany({
    where: { id: instanceId, version: instance.version },
    data: { version: { increment: 1 } },
  });

  if (locked.count === 0) {
    throw new Error(`Concurrent modification detected on workflow ${instanceId}. Please retry.`);
  }

  const definition = instance.template.definition as unknown as WorkflowDefinition;

  if (!definition.nodes || !Array.isArray(definition.nodes)) {
    logger.warn("Workflow definition has no graph nodes — skipping engine traversal", { instanceId });
    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  const completedTask = await db.workflowTask.findUnique({ where: { id: completedTaskId } });
  if (!completedTask) throw new Error(`Completed task ${completedTaskId} not found`);

  // Merge submitted form data into instance bag (outside transaction — low-risk write)
  if (formData && Object.keys(formData).length > 0) {
    const existing = (instance.formData as Record<string, unknown> | null) ?? {};
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { formData: { ...existing, ...formData } as object },
    });
  }

  // ---- REJECTED ----
  if (action === "REJECTED") {
    await db.$transaction([
      db.workflowInstance.update({
        where: { id: instanceId },
        data: { status: "REJECTED", completedAt: new Date() },
      }),
      db.workflowTask.updateMany({
        where: { instanceId, status: "PENDING", id: { not: completedTaskId } },
        data: { status: "SKIPPED" },
      }),
    ]);

    await notify(instance.initiatedById, "Workflow rejected",
      `Workflow "${instance.subject}" was rejected at step "${completedTask.stepName}".${comment ? ` Comment: ${comment}` : ""}`);

    return { nextTasks: [], workflowCompleted: false, workflowRejected: true };
  }

  // ---- RETURNED ----
  if (action === "RETURNED") {
    const previousTasks = await db.workflowTask.findMany({
      where: { instanceId, status: "COMPLETED", stepIndex: { lt: completedTask.stepIndex } },
      orderBy: { stepIndex: "desc" },
      take: 1,
    });

    if (previousTasks.length > 0) {
      const prev = previousTasks[0];
      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const revisionTask = await db.workflowTask.create({
        data: {
          instanceId,
          nodeId: prev.nodeId,
          stepName: `${prev.stepName} (Revision)`,
          stepIndex: prev.stepIndex,
          assigneeId: prev.assigneeId,
          status: "PENDING",
          dueAt,
        },
      });

      await db.workflowInstance.update({
        where: { id: instanceId },
        data: { currentStepIndex: prev.stepIndex },
      });

      if (prev.assigneeId) {
        await notify(prev.assigneeId, "Workflow returned for revision",
          `Step "${completedTask.stepName}" of "${instance.subject}" was returned. ${comment ? `Comment: ${comment}` : ""}`);
      }

      return { nextTasks: [revisionTask.id], workflowCompleted: false, workflowRejected: false };
    }

    await notify(instance.initiatedById, "Workflow returned for revision",
      `The first step "${completedTask.stepName}" of "${instance.subject}" was returned.${comment ? ` Comment: ${comment}` : ""}`);

    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  // ---- APPROVED — traverse the graph ----
  const currentNode = findNodeForTask(definition, completedTask);

  if (!currentNode) {
    logger.warn("Could not locate graph node for completed task — treating as terminal", {
      instanceId, taskId: completedTaskId, stepName: completedTask.stepName,
    });
    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  const freshInstance = await db.workflowInstance.findUnique({ where: { id: instanceId } });
  const workflowData: Record<string, unknown> = {
    ...((freshInstance?.formData as Record<string, unknown>) ?? {}),
    _action: action,
    _actor: actorId,
    _comment: comment,
  };

  const createdTaskIds: string[] = [];
  let workflowCompleted = false;

  await processNextNodes(
    definition, currentNode.id, undefined,
    instanceId, instance.initiatedById,
    workflowData, createdTaskIds,
    (v) => { workflowCompleted = v; },
    new Set()
  );

  if (!workflowCompleted && createdTaskIds.length === 0) {
    const pendingCount = await db.workflowTask.count({ where: { instanceId, status: "PENDING" } });
    if (pendingCount === 0) workflowCompleted = true;
  }

  if (workflowCompleted) {
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await notify(instance.initiatedById, "Workflow completed",
      `Workflow "${instance.subject}" has been approved and completed.`);

    // SMS completion alert to initiator
    const initiator = await db.user.findUnique({
      where: { id: instance.initiatedById },
      select: { phone: true, name: true, displayName: true },
    });
    if (initiator?.phone) {
      await sendSms({ to: initiator.phone, message: buildCompletionSms({ recipientName: initiator.displayName ?? initiator.name ?? "User", instanceRef: instance.referenceNumber ?? instanceId, subject: instance.subject, outcome: "COMPLETED" }) });
    }

    // If this is a subprocess child, advance the parent
    if (instance.parentInstanceId) {
      const parentSubprocessTask = await db.workflowTask.findFirst({
        where: {
          instanceId: instance.parentInstanceId,
          status: "PENDING",
          stepName: { contains: "(Subprocess)" },
        },
      });
      if (parentSubprocessTask) {
        await advanceWorkflow({
          instanceId: instance.parentInstanceId,
          completedTaskId: parentSubprocessTask.id,
          action: "APPROVED",
          actorId: "SYSTEM",
          comment: `Subprocess "${instance.subject}" completed`,
        });
      }
    }
  }

  return { nextTasks: createdTaskIds, workflowCompleted, workflowRejected: false };
}

// ========================== Condition Evaluation ===========================

export function evaluateConditions(
  conditions: (Condition | ConditionGroup)[],
  data: Record<string, unknown>
): string | null {
  for (const item of conditions) {
    // ConditionGroup (AND/OR logic)
    if ("logic" in item) {
      const group = item as ConditionGroup;
      const results = group.conditions.map((c) => {
        if ("logic" in c) {
          return evaluateConditions([c], data) !== null;
        }
        return testCondition(c as Condition, data);
      });

      const matched =
        group.logic === "AND" ? results.every(Boolean) : results.some(Boolean);

      if (matched) return group.handleId;
    } else {
      // Simple condition
      const cond = item as Condition;
      if (testCondition(cond, data)) return cond.handleId;
    }
  }
  return null;
}

function testCondition(cond: Condition, data: Record<string, unknown>): boolean {
  const rawValue = resolveFieldValue(data, cond.field);

  switch (cond.operator) {
    case "equals":         return String(rawValue) === cond.value;
    case "not_equals":     return String(rawValue) !== cond.value;
    case "greater_than":   return Number(rawValue) > Number(cond.value);
    case "less_than":      return Number(rawValue) < Number(cond.value);
    case "greater_equal":  return Number(rawValue) >= Number(cond.value);
    case "less_equal":     return Number(rawValue) <= Number(cond.value);
    case "contains":       return String(rawValue ?? "").includes(cond.value);
    case "not_contains":   return !String(rawValue ?? "").includes(cond.value);
    case "starts_with":    return String(rawValue ?? "").startsWith(cond.value);
    case "ends_with":      return String(rawValue ?? "").endsWith(cond.value);
    case "not_empty":      return rawValue !== null && rawValue !== undefined && rawValue !== "";
    case "empty":          return rawValue === null || rawValue === undefined || rawValue === "";
    case "in_list": {
      const list = cond.value.split(",").map((s) => s.trim());
      return list.includes(String(rawValue));
    }
    case "not_in_list": {
      const list = cond.value.split(",").map((s) => s.trim());
      return !list.includes(String(rawValue));
    }
    case "between": {
      const [min, max] = cond.value.split(",").map(Number);
      const n = Number(rawValue);
      return n >= min && n <= max;
    }
    case "date_before":
      return new Date(rawValue as string) < new Date(cond.value);
    case "date_after":
      return new Date(rawValue as string) > new Date(cond.value);
    case "date_between": {
      const [from, to] = cond.value.split(",").map((s) => new Date(s.trim()));
      const d = new Date(rawValue as string);
      return d >= from && d <= to;
    }
    case "regex": {
      try {
        return new RegExp(cond.value).test(String(rawValue ?? ""));
      } catch {
        return false;
      }
    }
    default:
      logger.warn(`Unknown condition operator: ${cond.operator}`);
      return false;
  }
}

// ========================== Graph Traversal ================================

export function findNextNodes(
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  currentNodeId: string,
  outputHandleId?: string
): WorkflowNode[] {
  const outEdges = definition.edges.filter((e) => {
    if (e.source !== currentNodeId) return false;
    if (outputHandleId != null && e.sourceHandle !== outputHandleId) return false;
    return true;
  });

  return outEdges
    .map((e) => definition.nodes.find((n) => n.id === e.target))
    .filter((n): n is WorkflowNode => !!n);
}

// ========================== Assignee Resolution ============================

export async function resolveAssignee(params: {
  assigneeRule: string;
  assigneeValue?: string;
  initiatorId: string;
  instanceId: string;
}): Promise<string | null> {
  const { assigneeRule, assigneeValue, initiatorId } = params;

  try {
    let resolvedId: string | null = null;

    switch (assigneeRule) {
      case "specific_user":
        resolvedId = assigneeValue ?? null;
        break;

      case "role_based": {
        if (!assigneeValue) break;
        const ur = await db.userRole.findFirst({
          where: { role: { name: assigneeValue }, user: { isActive: true } },
          select: { userId: true },
        });
        resolvedId = ur?.userId ?? null;
        break;
      }

      case "department": {
        if (!assigneeValue) break;
        const user = await db.user.findFirst({
          where: { department: assigneeValue, isActive: true },
          select: { id: true },
        });
        resolvedId = user?.id ?? null;
        break;
      }

      case "initiator":
        resolvedId = initiatorId;
        break;

      case "initiator_manager": {
        const initiator = await db.user.findUnique({
          where: { id: initiatorId },
          select: { department: true },
        });
        if (initiator?.department) {
          const head = await db.user.findFirst({
            where: {
              department: initiator.department,
              isActive: true,
              id: { not: initiatorId },
              roles: {
                some: {
                  role: { name: { in: ["Department Head", "HOD", "Head of Department", "Director"] } },
                },
              },
            },
            select: { id: true },
          });
          resolvedId = head?.id ?? initiatorId;
        } else {
          resolvedId = initiatorId;
        }
        break;
      }

      case "round_robin":
      case "least_loaded": {
        if (!assigneeValue) break;
        const candidates = await db.userRole.findMany({
          where: { role: { name: assigneeValue }, user: { isActive: true } },
          select: { userId: true },
        });
        if (candidates.length === 0) break;

        const counts = await Promise.all(
          candidates.map(async (c) => {
            const count = await db.workflowTask.count({
              where: { assigneeId: c.userId, status: "PENDING" },
            });
            return { userId: c.userId, count };
          })
        );
        counts.sort((a, b) => a.count - b.count);
        resolvedId = counts[0].userId;
        break;
      }

      // Pool: task goes to a shared queue; any member can claim it.
      // assigneeValue = pool name. Return special sentinel "POOL:{id}".
      case "pool": {
        if (!assigneeValue) break;
        const pool = await db.workflowPool.findUnique({
          where: { name: assigneeValue },
          select: { id: true },
        });
        if (pool) resolvedId = `POOL:${pool.id}`;
        break;
      }

      default:
        logger.warn(`Unknown assignee rule: ${assigneeRule}`);
    }

    // --- Delegation enforcement ---
    // If the resolved user has an active delegation, re-route to the delegate.
    if (resolvedId) {
      const now = new Date();
      const delegation = await db.delegation.findFirst({
        where: {
          delegatorId: resolvedId,
          isActive: true,
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
        select: { delegateId: true },
      });
      if (delegation) {
        logger.info("Task re-routed via active delegation", {
          original: resolvedId,
          delegate: delegation.delegateId,
        });
        resolvedId = delegation.delegateId;
      }
    }

    return resolvedId;
  } catch (error) {
    logger.error("Failed to resolve assignee", error, { assigneeRule });
    return null;
  }
}

// ========================== Parallel Join Check ============================

export async function checkParallelJoin(params: {
  instanceId: string;
  joinNodeId: string;
  joinRule: "all" | "any" | "quorum";
  quorumCount?: number;
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}): Promise<boolean> {
  const { instanceId, joinNodeId, joinRule, quorumCount, definition } = params;

  const incomingEdges = definition.edges.filter((e) => e.target === joinNodeId);
  if (incomingEdges.length === 0) return true;

  const completedSourceNodes = await Promise.all(
    incomingEdges.map(async (edge) => {
      const sourceNode = definition.nodes.find((n) => n.id === edge.source);
      if (!sourceNode) return false;

      const label = (sourceNode.data?.label as string) ?? "";

      // Task node: look for a completed task
      const completed = await db.workflowTask.findFirst({
        where: { instanceId, status: "COMPLETED", stepName: label },
      });
      if (completed) return true;

      // Non-task nodes leave a WorkflowEvent
      if (["email", "system", "timer"].includes(sourceNode.type)) {
        const event = await db.workflowEvent.findFirst({
          where: { instanceId, eventType: `NODE_COMPLETED_${sourceNode.id}` },
        });
        return !!event;
      }

      return false;
    })
  );

  const completedCount = completedSourceNodes.filter(Boolean).length;

  if (joinRule === "all") return completedCount === incomingEdges.length;
  if (joinRule === "any") return completedCount >= 1;
  if (joinRule === "quorum") return completedCount >= (quorumCount ?? Math.ceil(incomingEdges.length / 2));

  return false;
}

/**
 * When a parallel join fires in "any" or "quorum" mode, skip PENDING tasks
 * on branches that didn't win the join race.
 */
async function skipOrphanedBranchTasks(
  instanceId: string,
  joinNodeId: string,
  definition: WorkflowDefinition
): Promise<void> {
  const incomingEdges = definition.edges.filter((e) => e.target === joinNodeId);

  for (const edge of incomingEdges) {
    const sourceNode = definition.nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    const label = (sourceNode.data?.label as string) ?? "";
    const pendingTask = await db.workflowTask.findFirst({
      where: { instanceId, status: "PENDING", stepName: label },
    });
    if (pendingTask) {
      await db.workflowTask.update({
        where: { id: pendingTask.id },
        data: { status: "SKIPPED" },
      });
    }
  }
}

// ========================== Internal Helpers ===============================

function resolveFieldValue(data: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((cur, part) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[part];
  }, data);
}

function findNodeForTask(
  definition: WorkflowDefinition,
  task: { nodeId?: string | null; stepName: string; stepIndex: number }
): WorkflowNode | null {
  // 1. Prefer stored nodeId
  if (task.nodeId) {
    const byId = definition.nodes.find((n) => n.id === task.nodeId);
    if (byId) return byId;
  }

  // 2. Exact label match
  const byLabel = definition.nodes.find(
    (n) => n.type === "task" && (n.data.label as string) === task.stepName
  );
  if (byLabel) return byLabel;

  // 3. Label match ignoring "(Revision)" / "(Delegated)" suffix
  const baseName = task.stepName.replace(/\s*\((Revision|Delegated|Subprocess)\)\s*$/, "");
  const byBaseLabel = definition.nodes.find(
    (n) => n.type === "task" && (n.data.label as string) === baseName
  );
  if (byBaseLabel) return byBaseLabel;

  // 4. Positional fallback
  const taskNodes = definition.nodes
    .filter((n) => n.type === "task")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  return taskNodes[Math.min(task.stepIndex, taskNodes.length - 1)] ?? null;
}

async function notify(userId: string, title: string, body: string): Promise<void> {
  try {
    await db.notification.create({
      data: { userId, type: "WORKFLOW_TASK", title, body, linkUrl: "/workflows" },
    });
  } catch (error) {
    logger.error("Failed to send workflow notification", error, { userId });
  }
}

async function recordNodeEvent(
  instanceId: string,
  nodeId: string,
  eventType: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.workflowEvent.create({ data: { instanceId, eventType, data: data as object } });
  } catch (error) {
    logger.error("Failed to record workflow node event", error, { instanceId, nodeId });
  }
}

async function calculateDueDate(nodeData: Record<string, unknown>): Promise<Date> {
  const slaHours = nodeData.slaHours as number | undefined;
  const now = new Date();

  if (slaHours && slaHours > 0) {
    try {
      const cal = await getDefaultCalendar();
      return addWorkingHours(now, slaHours, cal);
    } catch {
      // Fallback to wall-clock if calendar unavailable
      return new Date(now.getTime() + slaHours * 60 * 60 * 1000);
    }
  }

  // Default: 7 calendar days
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function calculateTimerActivation(nodeData: Record<string, unknown>): Date {
  const timerType = (nodeData.timerType as string) ?? "duration";
  const now = new Date();

  if (timerType === "date" && nodeData.targetDate) {
    return new Date(nodeData.targetDate as string);
  }

  const hours = (nodeData.durationHours as number) ?? 0;
  const days = (nodeData.durationDays as number) ?? 0;
  const totalMs = (days * 24 + hours) * 60 * 60 * 1000;

  return totalMs > 0 ? new Date(now.getTime() + totalMs) : new Date(now.getTime() + 60 * 60 * 1000);
}

// ========================== Core Graph Processor ===========================

async function processNextNodes(
  definition: WorkflowDefinition,
  currentNodeId: string,
  outputHandleId: string | undefined,
  instanceId: string,
  initiatorId: string,
  workflowData: Record<string, unknown>,
  createdTaskIds: string[],
  setCompleted: (v: boolean) => void,
  visited: Set<string>
): Promise<void> {
  const visitKey = `${currentNodeId}:${outputHandleId ?? "*"}`;
  if (visited.has(visitKey)) {
    logger.warn("Cycle detected in workflow graph — aborting traversal", { instanceId, nodeId: currentNodeId });
    return;
  }
  visited.add(visitKey);

  const nextNodes = findNextNodes(definition, currentNodeId, outputHandleId);

  for (const node of nextNodes) {
    switch (node.type) {
      case "task": {
        await activateTaskNode(node, instanceId, initiatorId, createdTaskIds);
        break;
      }

      case "decision": {
        const rawConditions = (node.data.conditions as (Condition | ConditionGroup)[] | undefined) ?? [];
        const matchedHandle = evaluateConditions(rawConditions, workflowData);
        const handleToFollow = matchedHandle ?? "default";

        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "decision", matchedHandle: handleToFollow,
        });

        await processNextNodes(definition, node.id, handleToFollow, instanceId, initiatorId,
          workflowData, createdTaskIds, setCompleted, visited);
        break;
      }

      case "timer": {
        const activationTime = calculateTimerActivation(node.data);
        const label = (node.data.label as string) ?? "Timer Wait";

        const timerTask = await db.workflowTask.create({
          data: {
            instanceId,
            nodeId: node.id,
            stepName: label,
            stepIndex: -1,
            assigneeId: initiatorId,
            status: "PENDING",
            dueAt: activationTime,
          },
        });

        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "timer", activationTime: activationTime.toISOString(), timerTaskId: timerTask.id,
        });

        createdTaskIds.push(timerTask.id);
        break;
      }

      case "email": {
        await executeEmailNode(node, instanceId, initiatorId, workflowData);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, { type: "email" });
        await processNextNodes(definition, node.id, undefined, instanceId, initiatorId,
          workflowData, createdTaskIds, setCompleted, visited);
        break;
      }

      case "system": {
        await executeSystemNode(node, instanceId, workflowData);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "system", actionType: node.data.actionType,
        });
        await processNextNodes(definition, node.id, undefined, instanceId, initiatorId,
          workflowData, createdTaskIds, setCompleted, visited);
        break;
      }

      case "parallel": {
        const gatewayType = (node.data.gatewayType as string) ?? "fork";

        if (gatewayType === "fork") {
          await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, { type: "parallel_fork" });

          const outEdges = definition.edges.filter((e) => e.source === node.id);
          await Promise.all(
            outEdges.map((edge) =>
              processNextNodes(
                definition, node.id, edge.sourceHandle ?? undefined,
                instanceId, initiatorId, workflowData, createdTaskIds, setCompleted,
                new Set(visited)
              )
            )
          );
        } else {
          // join / merge
          const joinRule = (node.data.joinRule as "all" | "any" | "quorum") ?? "all";
          const quorumCount = node.data.quorumCount as number | undefined;

          const canProceed = await checkParallelJoin({
            instanceId, joinNodeId: node.id, joinRule, quorumCount, definition,
          });

          if (canProceed) {
            // For non-all joins, clean up orphaned pending tasks on other branches
            if (joinRule !== "all") {
              await skipOrphanedBranchTasks(instanceId, node.id, definition);
            }

            await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
              type: "parallel_join", joinRule,
            });

            await processNextNodes(definition, node.id, undefined, instanceId, initiatorId,
              workflowData, createdTaskIds, setCompleted, visited);
          }
        }
        break;
      }

      case "end": {
        setCompleted(true);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, { type: "end" });
        break;
      }

      case "start": {
        await processNextNodes(definition, node.id, undefined, instanceId, initiatorId,
          workflowData, createdTaskIds, setCompleted, visited);
        break;
      }

      case "subprocess": {
        await executeSubprocessNode(node, instanceId, initiatorId, workflowData, createdTaskIds);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "subprocess", templateId: node.data.subTemplateId,
        });
        // Traversal continues when the child workflow completes (see advanceWorkflow parent logic)
        break;
      }

      case "wait_signal": {
        // Create a WorkflowSignal record and a placeholder task (stepIndex = -2)
        // so the workflow pauses here until POST /api/workflows/signals/[key] fires.
        const signalName = (node.data.signalName as string) ?? node.id;
        const label = (node.data.label as string) ?? `Wait: ${signalName}`;
        const signalKey = `${instanceId}:${node.id}`;

        // Check if signal already received (idempotent on retry)
        const existing = await db.workflowSignal.findUnique({ where: { signalKey } });
        if (existing?.receivedAt) {
          // Signal already fired — continue traversal immediately
          await processNextNodes(definition, node.id, undefined, instanceId, initiatorId,
            workflowData, createdTaskIds, setCompleted, visited);
          break;
        }

        // Calculate optional timeout deadline from node config
        const timeoutHours = node.data.timeoutHours as number | undefined;
        const timeoutAt = timeoutHours
          ? new Date(Date.now() + timeoutHours * 3600 * 1000)
          : null;

        // Create (or upsert) the signal record and placeholder task
        const placeholder = await db.workflowTask.create({
          data: {
            instanceId,
            nodeId: node.id,
            stepName: label,
            stepIndex: -2,
            assigneeId: initiatorId,
            status: "PENDING",
            dueAt: timeoutAt,
          },
        });

        await db.workflowSignal.upsert({
          where: { signalKey },
          create: { signalKey, instanceId, nodeId: node.id, taskId: placeholder.id, timeoutAt },
          update: {},
        });

        await recordNodeEvent(instanceId, node.id, `NODE_WAITING_SIGNAL_${node.id}`, {
          type: "wait_signal", signalKey, signalName,
        });

        createdTaskIds.push(placeholder.id);
        // Traversal deliberately stops here — continues via resumeSignal()
        break;
      }

      default: {
        logger.warn(`Unknown node type "${node.type}" — skipping`, { instanceId, nodeId: node.id });
        break;
      }
    }
  }
}

// ========================== Node Activators ================================

async function activateTaskNode(
  node: WorkflowNode,
  instanceId: string,
  initiatorId: string,
  createdTaskIds: string[]
): Promise<void> {
  const data = node.data;
  const label = (data.label as string) ?? "Task";
  const assigneeRule = (data.assigneeRule as string) ?? "initiator";
  const assigneeValue = data.assigneeValue as string | undefined;

  const existingCount = await db.workflowTask.count({ where: { instanceId } });

  const resolvedId = await resolveAssignee({ assigneeRule, assigneeValue, initiatorId, instanceId });

  // Pool assignment — sentinel "POOL:{id}" means task goes into shared queue
  const isPoolTask = resolvedId?.startsWith("POOL:") ?? false;
  const poolId = isPoolTask ? resolvedId!.slice(5) : null;
  const finalAssigneeId = isPoolTask ? null : (resolvedId ?? initiatorId);

  if (!resolvedId && !isPoolTask) {
    logger.error("Could not resolve assignee — falling back to initiator", undefined, {
      instanceId, nodeId: node.id, assigneeRule,
    });
  }

  const dueAt = await calculateDueDate(data);

  const task = await db.workflowTask.create({
    data: {
      instanceId,
      nodeId: node.id,
      stepName: label,
      stepIndex: existingCount,
      assigneeId: finalAssigneeId,
      poolId,
      status: "PENDING",
      dueAt,
    },
  });

  createdTaskIds.push(task.id);

  await db.workflowInstance.update({
    where: { id: instanceId },
    data: { currentStepIndex: existingCount, status: "IN_PROGRESS" },
  });

  const inst = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: {
      subject: true,
      initiatedById: true,
      referenceNumber: true,
    },
  });

  if (isPoolTask && poolId) {
    // Notify all pool members that a task is available
    const members = await db.workflowPoolMember.findMany({
      where: { poolId },
      include: { user: { select: { id: true, email: true, name: true, displayName: true, phone: true } } },
    });
    for (const m of members) {
      await notify(m.userId, `Pool task available: ${label}`,
        `A new task "${label}" is available in your queue for: ${inst?.subject ?? "workflow"}`);
      if (m.user.phone) {
        const msg = buildTaskSms({
          recipientName: m.user.displayName ?? m.user.name ?? "User",
          stepName: label,
          instanceRef: instanceId,
          subject: inst?.subject ?? "workflow",
          dueAt,
          appUrl: process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/workflows` : undefined,
        });
        await sendSms({ to: m.user.phone, message: msg });
      }
    }
    return;
  }

  if (!finalAssigneeId) return;

  // In-app notification
  await notify(finalAssigneeId, "New workflow task assigned",
    `You have been assigned step "${label}" for: ${inst?.subject ?? "workflow"}`);

  // Email + SMS notification
  const assignee = await db.user.findUnique({
    where: { id: finalAssigneeId },
    select: { email: true, name: true, displayName: true, phone: true },
  });
  if (assignee?.email) {
    const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const initiator = inst?.initiatedById
      ? await db.user.findUnique({
          where: { id: inst.initiatedById },
          select: { displayName: true, name: true },
        })
      : null;
    await sendMail({
      to: assignee.email,
      subject: `Action Required: ${label}`,
      react: React.createElement(WorkflowActionRequired, {
        recipientName: assignee.displayName ?? assignee.name ?? "User",
        stepLabel: label,
        workflowSubject: inst?.subject ?? "Workflow item",
        workflowReference: inst?.referenceNumber,
        initiatorName: initiator?.displayName ?? initiator?.name,
        dueAt: dueAt?.toISOString(),
        actionUrl: `${baseUrl}/workflows`,
      }),
    });
  }
  if (assignee?.phone) {
    const msg = buildTaskSms({
      recipientName: assignee.displayName ?? assignee.name ?? "User",
      stepName: label,
      instanceRef: instanceId,
      subject: inst?.subject ?? "workflow",
      dueAt,
      appUrl: process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/workflows` : undefined,
    });
    await sendSms({ to: assignee.phone, message: msg });
  }
}

async function executeEmailNode(
  node: WorkflowNode,
  instanceId: string,
  initiatorId: string,
  workflowData: Record<string, unknown>
): Promise<void> {
  const data = node.data;
  const recipientType = (data.recipientType as string) ?? "initiator";
  const recipientValue = data.recipientValue as string | undefined;
  const subjectTemplate = (data.subject as string) ?? (data.label as string) ?? "Workflow Notification";
  const bodyTemplate = (data.bodyTemplate as string) ?? "";

  // Build interpolation vars from workflow data
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(workflowData)) {
    if (typeof v === "string" || typeof v === "number") vars[k] = String(v);
  }

  const subject = interpolate(subjectTemplate, vars);
  const body = interpolate(bodyTemplate, vars);

  let recipientId: string | null = null;
  let customEmail: string | null = null;

  switch (recipientType) {
    case "specific_user":
      recipientId = recipientValue ?? null;
      break;
    case "role": {
      if (recipientValue) {
        const ur = await db.userRole.findFirst({
          where: { role: { name: recipientValue }, user: { isActive: true } },
          select: { userId: true },
        });
        recipientId = ur?.userId ?? null;
      }
      break;
    }
    case "initiator":
      recipientId = initiatorId;
      break;
    case "previous_assignee": {
      const lastTask = await db.workflowTask.findFirst({
        where: { instanceId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        select: { assigneeId: true },
      });
      recipientId = lastTask?.assigneeId ?? initiatorId;
      break;
    }
    case "custom_email":
      customEmail = recipientValue ?? null;
      break;
    default:
      recipientId = initiatorId;
  }

  // Send to internal user
  if (recipientId) {
    await notify(recipientId, subject, body || `Notification from workflow step "${data.label}".`);

    const user = await db.user.findUnique({
      where: { id: recipientId },
      select: { email: true, name: true, displayName: true },
    });
    if (user?.email) {
      await sendMail({
        to: user.email,
        subject,
        react: React.createElement(WorkflowNotification, {
          recipientName: user.displayName ?? user.name ?? "User",
          subject,
          body,
        }),
      });
    }
  }

  // Send to external email
  if (customEmail) {
    await sendMail({
      to: customEmail,
      subject,
      react: React.createElement(WorkflowNotification, {
        recipientName: "Recipient",
        subject,
        body,
      }),
    });
  }
}

async function executeSystemNode(
  node: WorkflowNode,
  instanceId: string,
  workflowData: Record<string, unknown>
): Promise<void> {
  const data = node.data;
  const actionType = (data.actionType as string) ?? "";
  const actionConfig = (data.actionConfig as Record<string, unknown>) ?? {};

  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { documentId: true, initiatedById: true, subject: true },
  });

  try {
    switch (actionType) {
      case "update_document_status": {
        if (instance?.documentId && actionConfig.status) {
          await db.document.update({
            where: { id: instance.documentId },
            data: { status: actionConfig.status as never },
          });
        }
        break;
      }

      case "update_metadata": {
        if (instance?.documentId && actionConfig.metadata) {
          const doc = await db.document.findUnique({
            where: { id: instance.documentId },
            select: { metadata: true },
          });
          const existing = (doc?.metadata as Record<string, unknown>) ?? {};
          await db.document.update({
            where: { id: instance.documentId },
            data: { metadata: { ...existing, ...(actionConfig.metadata as Record<string, unknown>) } as object },
          });
        }
        break;
      }

      case "create_notification": {
        if (instance?.initiatedById) {
          const vars: Record<string, string> = {};
          for (const [k, v] of Object.entries(workflowData)) {
            if (typeof v === "string" || typeof v === "number") vars[k] = String(v);
          }
          const title = interpolate((actionConfig.title as string) ?? "System Notification", vars);
          const body = interpolate(
            (actionConfig.body as string) ?? `Automated notification for "${instance.subject}".`, vars
          );
          await notify(instance.initiatedById, title, body);
        }
        break;
      }

      case "assign_classification": {
        if (instance?.documentId && actionConfig.classificationNodeId) {
          await db.document.update({
            where: { id: instance.documentId },
            data: { classificationNodeId: actionConfig.classificationNodeId as string },
          });
        }
        break;
      }

      case "send_webhook": {
        await dispatchWebhook({
          instanceId,
          nodeId: node.id,
          url: (actionConfig.url as string) ?? "",
          headers: (actionConfig.headers as Record<string, string>) ?? {},
          workflowData,
        });
        break;
      }

      default:
        logger.warn(`Unknown system action type: ${actionType}`, { instanceId, nodeId: node.id });
    }
  } catch (error) {
    logger.error("System node execution failed", error, { instanceId, nodeId: node.id, actionType });
  }
}

async function executeSubprocessNode(
  node: WorkflowNode,
  parentInstanceId: string,
  initiatorId: string,
  workflowData: Record<string, unknown>,
  createdTaskIds: string[]
): Promise<void> {
  const subTemplateId = node.data.subTemplateId as string | undefined;
  if (!subTemplateId) {
    logger.warn("Subprocess node has no subTemplateId — skipping", { parentInstanceId, nodeId: node.id });
    return;
  }

  const subTemplate = await db.workflowTemplate.findUnique({ where: { id: subTemplateId } });
  if (!subTemplate) {
    logger.error("Subprocess template not found", undefined, { subTemplateId });
    return;
  }

  const parentInstance = await db.workflowInstance.findUnique({
    where: { id: parentInstanceId },
    select: { subject: true, documentId: true },
  });

  // Generate a reference number for the child
  const { generateWorkflowReference } = await import("@/lib/reference");
  const ref = await generateWorkflowReference();

  const childInstance = await db.workflowInstance.create({
    data: {
      referenceNumber: ref,
      templateId: subTemplateId,
      templateVersion: subTemplate.version,
      parentInstanceId,
      documentId: parentInstance?.documentId ?? null,
      initiatedById: initiatorId,
      subject: `[Sub] ${parentInstance?.subject ?? "Subprocess"}`,
      status: "IN_PROGRESS",
      currentStepIndex: 0,
      formData: workflowData as object,
    },
  });

  // Create a placeholder task on the parent so we know it's waiting
  const placeholderTask = await db.workflowTask.create({
    data: {
      instanceId: parentInstanceId,
      nodeId: node.id,
      stepName: `${(node.data.label as string) ?? "Subprocess"} (Subprocess)`,
      stepIndex: -1,
      assigneeId: initiatorId,
      status: "PENDING",
    },
  });
  createdTaskIds.push(placeholderTask.id);

  // Bootstrap the child workflow's first task nodes
  const childDef = subTemplate.definition as unknown as WorkflowDefinition;
  if (childDef.nodes && Array.isArray(childDef.nodes)) {
    const startNodes = childDef.nodes.filter((n) => n.type === "start");
    const childCreatedIds: string[] = [];
    let childCompleted = false;

    for (const startNode of startNodes) {
      await processNextNodes(
        childDef, startNode.id, undefined,
        childInstance.id, initiatorId,
        workflowData, childCreatedIds,
        (v) => { childCompleted = v; },
        new Set()
      );
    }

    if (childCompleted) {
      await db.workflowInstance.update({
        where: { id: childInstance.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}

// ========================== Webhook Dispatch ================================

async function dispatchWebhook(params: {
  instanceId: string;
  nodeId: string;
  url: string;
  headers: Record<string, string>;
  workflowData: Record<string, unknown>;
}): Promise<void> {
  const { instanceId, nodeId, url, headers, workflowData } = params;

  if (!url) {
    logger.warn("Webhook node has no URL configured", { instanceId, nodeId });
    return;
  }

  const payload = { instanceId, workflowData, timestamp: new Date().toISOString() };

  // Create a log entry for tracking
  const logEntry = await db.webhookLog.create({
    data: { instanceId, nodeId, url, payload: payload as object, status: "PENDING" },
  });

  await attemptWebhook(logEntry.id, url, headers, payload);
}

export async function attemptWebhook(
  logId: string,
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS = [30, 300, 1800]; // 30s, 5m, 30m

  const log = await db.webhookLog.findUnique({ where: { id: logId } });
  if (!log) return;

  const attemptNum = log.attempts + 1;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const responseBody = await res.text().catch(() => "");

    if (res.ok) {
      await db.webhookLog.update({
        where: { id: logId },
        data: {
          status: "SUCCESS",
          attempts: attemptNum,
          lastAttemptAt: new Date(),
          responseCode: res.status,
          responseBody: responseBody.slice(0, 1000),
        },
      });
    } else {
      const nextRetry = attemptNum < MAX_ATTEMPTS
        ? new Date(Date.now() + RETRY_DELAYS[attemptNum - 1] * 1000)
        : null;

      await db.webhookLog.update({
        where: { id: logId },
        data: {
          status: attemptNum >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          attempts: attemptNum,
          lastAttemptAt: new Date(),
          responseCode: res.status,
          responseBody: responseBody.slice(0, 1000),
          nextRetryAt: nextRetry,
        },
      });
    }
  } catch (error) {
    const nextRetry = attemptNum < MAX_ATTEMPTS
      ? new Date(Date.now() + RETRY_DELAYS[Math.min(attemptNum - 1, RETRY_DELAYS.length - 1)] * 1000)
      : null;

    await db.webhookLog.update({
      where: { id: logId },
      data: {
        status: attemptNum >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        attempts: attemptNum,
        lastAttemptAt: new Date(),
        nextRetryAt: nextRetry,
      },
    });

    logger.error("Webhook dispatch failed", error, { logId, url, attempt: attemptNum });
  }
}
