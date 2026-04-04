// ---------------------------------------------------------------------------
// Workflow Execution Engine
// ---------------------------------------------------------------------------
// Processes workflow instances by traversing the node graph defined in the
// WorkflowTemplate definition.  Replaces the old linear step-advancement
// logic with full support for decision gateways, parallel forks/joins,
// timer nodes, email/system actions, and flexible assignee resolution.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ========================== Type Definitions ===============================

/** A node in the ReactFlow-based workflow definition. */
interface WorkflowNode {
  id: string;
  type: string; // start | task | decision | end | timer | email | system | parallel | subprocess
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** An edge connecting two nodes. */
interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [key: string]: unknown;
}

/** The full graph stored in WorkflowTemplate.definition. */
interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  steps?: unknown[]; // legacy format -- unused by the engine
}

/** A single condition row configured on a decision node. */
interface Condition {
  field: string;
  operator: string;
  value: string;
  handleId: string; // which source handle to follow if this condition is true
}

// ========================== Public API =====================================

/**
 * Advance a workflow after a task action (approve / reject / return).
 *
 * This is the main entry point called by the task action API route.  It:
 *   1. Loads the instance, template definition, and completed task.
 *   2. Determines which node was just completed.
 *   3. Traverses the graph to activate the next node(s).
 *   4. Returns summary information for the API response.
 */
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
  const { instanceId, completedTaskId, action, actorId, comment, formData } =
    params;

  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { template: true },
  });

  if (!instance) {
    throw new Error(`Workflow instance ${instanceId} not found`);
  }

  const definition = instance.template.definition as unknown as WorkflowDefinition;

  // Guard: if the template was saved in legacy steps-only format we cannot
  // traverse a graph.  Fall back gracefully.
  if (!definition.nodes || !Array.isArray(definition.nodes)) {
    logger.warn("Workflow definition has no graph nodes -- skipping engine traversal", {
      action: "advanceWorkflow",
      instanceId,
    });
    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  const completedTask = await db.workflowTask.findUnique({
    where: { id: completedTaskId },
  });

  if (!completedTask) {
    throw new Error(`Completed task ${completedTaskId} not found`);
  }

  // Merge any submitted form data into the instance-level formData bag.
  if (formData && Object.keys(formData).length > 0) {
    const existing =
      (instance.formData as Record<string, unknown> | null) ?? {};
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { formData: { ...existing, ...formData } as object },
    });
  }

  // ------------------------------------------------------------------
  // Handle REJECTED -- terminates the entire workflow
  // ------------------------------------------------------------------
  if (action === "REJECTED") {
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "REJECTED", completedAt: new Date() },
    });

    // Skip all remaining pending tasks
    await db.workflowTask.updateMany({
      where: {
        instanceId,
        status: "PENDING",
        id: { not: completedTaskId },
      },
      data: { status: "SKIPPED" },
    });

    await notify(instance.initiatedById, "Workflow rejected", `Workflow "${instance.subject}" was rejected at step "${completedTask.stepName}".${comment ? ` Comment: ${comment}` : ""}`);

    logger.info("Workflow rejected", { action: "advanceWorkflow", instanceId });
    return { nextTasks: [], workflowCompleted: false, workflowRejected: true };
  }

  // ------------------------------------------------------------------
  // Handle RETURNED -- create a revision task for the previous assignee
  // ------------------------------------------------------------------
  if (action === "RETURNED") {
    const previousTasks = await db.workflowTask.findMany({
      where: {
        instanceId,
        status: "COMPLETED",
        stepIndex: { lt: completedTask.stepIndex },
      },
      orderBy: { stepIndex: "desc" },
      take: 1,
    });

    if (previousTasks.length > 0) {
      const prev = previousTasks[0];
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 7);

      const revisionTask = await db.workflowTask.create({
        data: {
          instanceId,
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

      await notify(prev.assigneeId, "Workflow returned for revision", `Step "${completedTask.stepName}" of "${instance.subject}" was returned. ${comment ? `Comment: ${comment}` : ""}`);

      return {
        nextTasks: [revisionTask.id],
        workflowCompleted: false,
        workflowRejected: false,
      };
    }

    // If there is no previous task, notify the initiator
    await notify(instance.initiatedById, "Workflow returned for revision", `The first step "${completedTask.stepName}" of "${instance.subject}" was returned.${comment ? ` Comment: ${comment}` : ""}`);

    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  // ------------------------------------------------------------------
  // Handle APPROVED -- traverse the graph forward
  // ------------------------------------------------------------------

  // Find the node that corresponds to the completed task.  We match on the
  // task's stepName against node data.label, or if the task carries a
  // nodeId stored in its metadata we use that directly.
  const currentNode = findNodeForTask(definition, completedTask);

  if (!currentNode) {
    logger.warn("Could not locate graph node for completed task -- treating as terminal", {
      action: "advanceWorkflow",
      instanceId,
      taskId: completedTaskId,
      stepName: completedTask.stepName,
    });
    return { nextTasks: [], workflowCompleted: false, workflowRejected: false };
  }

  // Collect freshest form data for condition evaluation
  const freshInstance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
  });
  const workflowData: Record<string, unknown> = {
    ...((freshInstance?.formData as Record<string, unknown>) ?? {}),
    _action: action,
    _actor: actorId,
    _comment: comment,
  };

  const createdTaskIds: string[] = [];
  let workflowCompleted = false;

  // Recursive graph processor
  await processNextNodes(
    definition,
    currentNode.id,
    undefined, // no specific output handle for a simple approval
    instanceId,
    instance.initiatedById,
    workflowData,
    createdTaskIds,
    (v) => {
      workflowCompleted = v;
    },
    new Set()
  );

  // If no new tasks were created and workflow is not explicitly completed,
  // check whether ALL tasks in the instance are done.
  if (!workflowCompleted && createdTaskIds.length === 0) {
    const pendingCount = await db.workflowTask.count({
      where: { instanceId, status: "PENDING" },
    });

    if (pendingCount === 0) {
      workflowCompleted = true;
    }
  }

  if (workflowCompleted) {
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await notify(instance.initiatedById, "Workflow completed", `Workflow "${instance.subject}" has been approved and completed.`);
  }

  return {
    nextTasks: createdTaskIds,
    workflowCompleted,
    workflowRejected: false,
  };
}

// ========================== Condition Evaluation ===========================

/**
 * Evaluate an array of conditions against a data bag.
 *
 * Returns the `handleId` of the first condition that matches, or `null` if
 * none match (caller should follow the "default" handle).
 */
export function evaluateConditions(
  conditions: Condition[],
  data: Record<string, unknown>
): string | null {
  for (const cond of conditions) {
    const rawValue = resolveFieldValue(data, cond.field);

    switch (cond.operator) {
      case "equals":
        if (String(rawValue) === cond.value) return cond.handleId;
        break;

      case "not_equals":
        if (String(rawValue) !== cond.value) return cond.handleId;
        break;

      case "greater_than":
        if (Number(rawValue) > Number(cond.value)) return cond.handleId;
        break;

      case "less_than":
        if (Number(rawValue) < Number(cond.value)) return cond.handleId;
        break;

      case "contains":
        if (String(rawValue ?? "").includes(cond.value)) return cond.handleId;
        break;

      case "not_empty":
        if (rawValue !== null && rawValue !== undefined && rawValue !== "")
          return cond.handleId;
        break;

      case "empty":
        if (rawValue === null || rawValue === undefined || rawValue === "")
          return cond.handleId;
        break;

      case "in_list": {
        const list = cond.value.split(",").map((s) => s.trim());
        if (list.includes(String(rawValue))) return cond.handleId;
        break;
      }

      default:
        logger.warn(`Unknown condition operator: ${cond.operator}`);
    }
  }

  return null;
}

// ========================== Graph Traversal ================================

/**
 * Find the immediate successor nodes reachable from `currentNodeId`,
 * optionally filtered to a specific `outputHandleId`.
 */
export function findNextNodes(
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  currentNodeId: string,
  outputHandleId?: string
): WorkflowNode[] {
  const outEdges = definition.edges.filter((e) => {
    if (e.source !== currentNodeId) return false;
    if (outputHandleId != null && e.sourceHandle !== outputHandleId)
      return false;
    return true;
  });

  const nextNodes: WorkflowNode[] = [];
  for (const edge of outEdges) {
    const node = definition.nodes.find((n) => n.id === edge.target);
    if (node) nextNodes.push(node);
  }

  return nextNodes;
}

// ========================== Assignee Resolution ============================

/**
 * Resolve the assignee for a task node based on its assignment rule.
 *
 * Returns a user ID or `null` if no suitable user can be found.
 */
export async function resolveAssignee(params: {
  assigneeRule: string;
  assigneeValue?: string;
  initiatorId: string;
  instanceId: string;
}): Promise<string | null> {
  const { assigneeRule, assigneeValue, initiatorId } = params;

  try {
    switch (assigneeRule) {
      // ----- Direct assignment -----
      case "specific_user":
        return assigneeValue ?? null;

      // ----- Role-based: first active user with matching role -----
      case "role_based": {
        if (!assigneeValue) return null;
        const ur = await db.userRole.findFirst({
          where: {
            role: { name: assigneeValue },
            user: { isActive: true },
          },
          select: { userId: true },
        });
        return ur?.userId ?? null;
      }

      // ----- Department: first active user in that department -----
      case "department": {
        if (!assigneeValue) return null;
        const user = await db.user.findFirst({
          where: { department: assigneeValue, isActive: true },
          select: { id: true },
        });
        return user?.id ?? null;
      }

      // ----- Initiator -----
      case "initiator":
        return initiatorId;

      // ----- Initiator's manager (department head) -----
      case "initiator_manager": {
        const initiator = await db.user.findUnique({
          where: { id: initiatorId },
          select: { department: true },
        });
        if (initiator?.department) {
          // Look for a user with role "Department Head" or "HOD" in the same department
          const head = await db.user.findFirst({
            where: {
              department: initiator.department,
              isActive: true,
              id: { not: initiatorId },
              roles: {
                some: {
                  role: {
                    name: {
                      in: [
                        "Department Head",
                        "HOD",
                        "Head of Department",
                        "Director",
                      ],
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (head) return head.id;
        }
        // Fallback to initiator
        return initiatorId;
      }

      // ----- Round robin / least loaded: user with fewest pending tasks -----
      case "round_robin":
      case "least_loaded": {
        if (!assigneeValue) return null;

        // Find all active users in the given role
        const candidates = await db.userRole.findMany({
          where: {
            role: { name: assigneeValue },
            user: { isActive: true },
          },
          select: { userId: true },
        });

        if (candidates.length === 0) return null;

        // Count pending tasks for each candidate
        const counts = await Promise.all(
          candidates.map(async (c) => {
            const count = await db.workflowTask.count({
              where: { assigneeId: c.userId, status: "PENDING" },
            });
            return { userId: c.userId, count };
          })
        );

        // Sort by fewest pending tasks
        counts.sort((a, b) => a.count - b.count);
        return counts[0].userId;
      }

      default:
        logger.warn(`Unknown assignee rule: ${assigneeRule}`);
        return null;
    }
  } catch (error) {
    logger.error("Failed to resolve assignee", error, {
      action: "resolveAssignee",
      assigneeRule,
    });
    return null;
  }
}

// ========================== Parallel Join Check ============================

/**
 * Determine whether a parallel join gateway should activate.
 *
 * For "all" mode: every incoming path must have a completed task.
 * For "any" mode: at least one incoming path must have a completed task.
 */
export async function checkParallelJoin(params: {
  instanceId: string;
  joinNodeId: string;
  joinRule: "all" | "any";
  definition: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}): Promise<boolean> {
  const { instanceId, joinNodeId, joinRule, definition } = params;

  // Find all edges that target this join node
  const incomingEdges = definition.edges.filter(
    (e) => e.target === joinNodeId
  );

  if (incomingEdges.length === 0) return true;

  // For each incoming edge, find the source node and check if there is a
  // completed task for it in this instance.
  const completedSourceNodes = await Promise.all(
    incomingEdges.map(async (edge) => {
      const sourceNode = definition.nodes.find((n) => n.id === edge.source);
      if (!sourceNode) return false;

      const label = (sourceNode.data?.label as string) ?? "";

      // Check if any completed task matches this source node
      const completed = await db.workflowTask.findFirst({
        where: {
          instanceId,
          status: "COMPLETED",
          stepName: label,
        },
      });

      // Also check for non-task nodes (email, system, timer) that execute
      // immediately -- they leave a workflow event rather than a task.
      if (!completed && ["email", "system", "timer"].includes(sourceNode.type)) {
        const event = await db.workflowEvent.findFirst({
          where: {
            instanceId,
            eventType: `NODE_COMPLETED_${sourceNode.id}`,
          },
        });
        return !!event;
      }

      return !!completed;
    })
  );

  if (joinRule === "all") {
    return completedSourceNodes.every(Boolean);
  }
  // "any"
  return completedSourceNodes.some(Boolean);
}

// ========================== Internal Helpers ===============================

/**
 * Resolve a potentially dot-separated field path against a data object.
 * E.g. "applicant.department" retrieves data.applicant.department.
 */
function resolveFieldValue(
  data: Record<string, unknown>,
  field: string
): unknown {
  const parts = field.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Best-effort match of a completed WorkflowTask to a graph node.
 *
 * Strategy: match on stepName === node.data.label.  If the definition
 * only has one task node this is trivial; otherwise we rely on the label
 * matching, falling back to stepIndex-based positional matching among
 * task nodes.
 */
function findNodeForTask(
  definition: WorkflowDefinition,
  task: { stepName: string; stepIndex: number }
): WorkflowNode | null {
  // 1. Exact label match
  const byLabel = definition.nodes.find(
    (n) =>
      n.type === "task" &&
      (n.data.label as string) === task.stepName
  );
  if (byLabel) return byLabel;

  // 2. Label match ignoring "(Revision)" suffix
  const baseName = task.stepName.replace(/\s*\(Revision\)\s*$/, "");
  const byBaseLabel = definition.nodes.find(
    (n) =>
      n.type === "task" &&
      (n.data.label as string) === baseName
  );
  if (byBaseLabel) return byBaseLabel;

  // 3. Positional: sort task nodes by x then y, pick by index
  const taskNodes = definition.nodes
    .filter((n) => n.type === "task")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  if (task.stepIndex < taskNodes.length) {
    return taskNodes[task.stepIndex];
  }

  return taskNodes[taskNodes.length - 1] ?? null;
}

/**
 * Send an in-app notification (non-blocking -- failures are logged but do
 * not interrupt the workflow).
 */
async function notify(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId,
        type: "WORKFLOW_TASK",
        title,
        body,
        linkUrl: "/workflows",
      },
    });
  } catch (error) {
    logger.error("Failed to send workflow notification", error, {
      action: "notify",
      userId,
    });
  }
}

/**
 * Record a workflow event for non-task node execution (email, system, timer).
 */
async function recordNodeEvent(
  instanceId: string,
  nodeId: string,
  eventType: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.workflowEvent.create({
      data: {
        instanceId,
        eventType,
        data: data as object,
      },
    });
  } catch (error) {
    logger.error("Failed to record workflow node event", error, {
      action: "recordNodeEvent",
      instanceId,
      nodeId,
    });
  }
}

/**
 * Calculate a due date for a new task based on SLA hours configured on the
 * node, falling back to a 7-day default.
 */
function calculateDueDate(nodeData: Record<string, unknown>): Date {
  const slaHours = nodeData.slaHours as number | undefined;
  const due = new Date();

  if (slaHours && slaHours > 0) {
    due.setTime(due.getTime() + slaHours * 60 * 60 * 1000);
  } else {
    due.setDate(due.getDate() + 7);
  }

  return due;
}

/**
 * Calculate the activation time for a timer node.
 */
function calculateTimerActivation(
  nodeData: Record<string, unknown>
): Date {
  const timerType = (nodeData.timerType as string) ?? "duration";
  const now = new Date();

  if (timerType === "date" && nodeData.targetDate) {
    return new Date(nodeData.targetDate as string);
  }

  const hours = (nodeData.durationHours as number) ?? 0;
  const days = (nodeData.durationDays as number) ?? 0;
  const totalMs = (days * 24 + hours) * 60 * 60 * 1000;

  if (totalMs > 0) {
    return new Date(now.getTime() + totalMs);
  }

  // Default: 1 hour
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/**
 * Core recursive graph processor.
 *
 * Given a node that was just completed, find and process all successor nodes.
 * Task nodes create WorkflowTask rows; pass-through nodes (email, system,
 * decision, parallel fork) execute immediately and recurse onward.
 */
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
  // Guard against infinite loops in a malformed graph
  const visitKey = `${currentNodeId}:${outputHandleId ?? "*"}`;
  if (visited.has(visitKey)) {
    logger.warn("Cycle detected in workflow graph -- aborting traversal", {
      action: "processNextNodes",
      instanceId,
      nodeId: currentNodeId,
    });
    return;
  }
  visited.add(visitKey);

  const nextNodes = findNextNodes(definition, currentNodeId, outputHandleId);

  for (const node of nextNodes) {
    switch (node.type) {
      // ---- Task: create a WorkflowTask and stop traversal on this path ----
      case "task": {
        await activateTaskNode(
          node,
          instanceId,
          initiatorId,
          createdTaskIds
        );
        break;
      }

      // ---- Decision: evaluate conditions and follow the matching edge -----
      case "decision": {
        const conditions =
          (node.data.conditions as Condition[] | undefined) ?? [];
        const matchedHandle = evaluateConditions(conditions, workflowData);

        // Follow the matched handle, or fall back to "default"
        const handleToFollow = matchedHandle ?? "default";

        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "decision",
          matchedHandle: handleToFollow,
        });

        await processNextNodes(
          definition,
          node.id,
          handleToFollow,
          instanceId,
          initiatorId,
          workflowData,
          createdTaskIds,
          setCompleted,
          visited
        );
        break;
      }

      // ---- Timer: create a delayed task that activates after the timer -----
      case "timer": {
        const activationTime = calculateTimerActivation(node.data);
        const label = (node.data.label as string) ?? "Timer Wait";

        // We model timers as a pending task assigned to the initiator with
        // a future dueAt.  A scheduled job should pick these up.
        const timerTask = await db.workflowTask.create({
          data: {
            instanceId,
            stepName: label,
            stepIndex: -1, // timers are not sequential steps
            assigneeId: initiatorId,
            status: "PENDING",
            dueAt: activationTime,
          },
        });

        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "timer",
          activationTime: activationTime.toISOString(),
          timerTaskId: timerTask.id,
        });

        createdTaskIds.push(timerTask.id);
        break;
      }

      // ---- Email: send notification immediately, then continue -----------
      case "email": {
        await executeEmailNode(node, instanceId, initiatorId);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "email",
        });

        // Continue traversal past the email node
        await processNextNodes(
          definition,
          node.id,
          undefined,
          instanceId,
          initiatorId,
          workflowData,
          createdTaskIds,
          setCompleted,
          visited
        );
        break;
      }

      // ---- System: execute action immediately, then continue --------
      case "system": {
        await executeSystemNode(node, instanceId);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "system",
          actionType: node.data.actionType,
        });

        await processNextNodes(
          definition,
          node.id,
          undefined,
          instanceId,
          initiatorId,
          workflowData,
          createdTaskIds,
          setCompleted,
          visited
        );
        break;
      }

      // ---- Parallel Fork: activate ALL outgoing paths --------------------
      case "parallel": {
        const gatewayType = (node.data.gatewayType as string) ?? "fork";

        if (gatewayType === "fork") {
          // Fork: activate every outgoing edge in parallel
          await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
            type: "parallel_fork",
          });

          // Get all outgoing edges from this fork and process them all
          const outEdges = definition.edges.filter(
            (e) => e.source === node.id
          );

          await Promise.all(
            outEdges.map((edge) => {
              const targetNode = definition.nodes.find(
                (n) => n.id === edge.target
              );
              if (!targetNode) return Promise.resolve();

              // Process each branch independently with its own visited set fork
              return processNextNodes(
                definition,
                node.id,
                edge.sourceHandle ?? undefined,
                instanceId,
                initiatorId,
                workflowData,
                createdTaskIds,
                setCompleted,
                new Set(visited) // fresh copy to allow independent traversal
              );
            })
          );
        } else {
          // Join: check if the join condition is satisfied
          const joinRule =
            (node.data.joinRule as "all" | "any") ?? "all";
          const canProceed = await checkParallelJoin({
            instanceId,
            joinNodeId: node.id,
            joinRule,
            definition,
          });

          if (canProceed) {
            await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
              type: "parallel_join",
              joinRule,
            });

            await processNextNodes(
              definition,
              node.id,
              undefined,
              instanceId,
              initiatorId,
              workflowData,
              createdTaskIds,
              setCompleted,
              visited
            );
          }
          // If not ready yet, do nothing -- the join will be re-evaluated
          // when the next incoming branch completes.
        }
        break;
      }

      // ---- End: mark workflow as completed -------------------------------
      case "end": {
        setCompleted(true);
        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "end",
        });
        break;
      }

      // ---- Start: should not appear as a successor, but handle it --------
      case "start": {
        // Just continue past it
        await processNextNodes(
          definition,
          node.id,
          undefined,
          instanceId,
          initiatorId,
          workflowData,
          createdTaskIds,
          setCompleted,
          visited
        );
        break;
      }

      // ---- Subprocess: future extension -- treat as pass-through ---------
      case "subprocess": {
        logger.info("Subprocess node encountered -- treating as pass-through", {
          action: "processNextNodes",
          instanceId,
          nodeId: node.id,
        });

        await recordNodeEvent(instanceId, node.id, `NODE_COMPLETED_${node.id}`, {
          type: "subprocess",
          templateId: node.data.templateId,
        });

        await processNextNodes(
          definition,
          node.id,
          undefined,
          instanceId,
          initiatorId,
          workflowData,
          createdTaskIds,
          setCompleted,
          visited
        );
        break;
      }

      default: {
        logger.warn(`Unknown node type "${node.type}" -- skipping`, {
          action: "processNextNodes",
          instanceId,
          nodeId: node.id,
        });
        break;
      }
    }
  }
}

// ========================== Node Activators ================================

/**
 * Create a WorkflowTask for a task node, resolving the assignee and
 * sending a notification.
 */
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

  // Determine step index: count existing tasks for this instance
  const existingCount = await db.workflowTask.count({
    where: { instanceId },
  });

  const assigneeId = await resolveAssignee({
    assigneeRule,
    assigneeValue,
    initiatorId,
    instanceId,
  });

  if (!assigneeId) {
    logger.error("Could not resolve assignee for task node -- assigning to initiator", undefined, {
      action: "activateTaskNode",
      instanceId,
      nodeId: node.id,
      assigneeRule,
    });
  }

  const finalAssigneeId = assigneeId ?? initiatorId;
  const dueAt = calculateDueDate(data);

  const task = await db.workflowTask.create({
    data: {
      instanceId,
      stepName: label,
      stepIndex: existingCount,
      assigneeId: finalAssigneeId,
      status: "PENDING",
      dueAt,
    },
  });

  createdTaskIds.push(task.id);

  // Update the instance's currentStepIndex
  await db.workflowInstance.update({
    where: { id: instanceId },
    data: {
      currentStepIndex: existingCount,
      status: "IN_PROGRESS",
    },
  });

  // Notify the assignee
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { subject: true },
  });

  await notify(
    finalAssigneeId,
    "New workflow task assigned",
    `You have been assigned step "${label}" for: ${instance?.subject ?? "workflow"}`
  );

  logger.info("Task node activated", {
    action: "activateTaskNode",
    instanceId,
    taskId: task.id,
    nodeId: node.id,
    assigneeId: finalAssigneeId,
  });
}

/**
 * Execute an email notification node.  Creates an in-app notification
 * to the configured recipient.  Actual email sending can be added later
 * by integrating with a mail service.
 */
async function executeEmailNode(
  node: WorkflowNode,
  instanceId: string,
  initiatorId: string
): Promise<void> {
  const data = node.data;
  const recipientType = (data.recipientType as string) ?? "initiator";
  const recipientValue = data.recipientValue as string | undefined;
  const subject =
    (data.subject as string) ?? (data.label as string) ?? "Workflow Notification";
  const bodyTemplate = (data.bodyTemplate as string) ?? "";

  let recipientId: string | null = null;

  switch (recipientType) {
    case "specific_user":
      recipientId = recipientValue ?? null;
      break;

    case "role": {
      if (recipientValue) {
        const ur = await db.userRole.findFirst({
          where: {
            role: { name: recipientValue },
            user: { isActive: true },
          },
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
      // For custom emails we would need actual email sending.
      // For now, log it.
      logger.info("Email node with custom_email recipient -- no in-app notification created", {
        action: "executeEmailNode",
        instanceId,
        nodeId: node.id,
        recipientValue,
      });
      return;

    default:
      recipientId = initiatorId;
  }

  if (recipientId) {
    await notify(
      recipientId,
      subject,
      bodyTemplate || `Notification from workflow step "${(data.label as string) ?? "Email"}".`
    );
  }

  logger.info("Email node executed", {
    action: "executeEmailNode",
    instanceId,
    nodeId: node.id,
    recipientType,
  });
}

/**
 * Execute a system action node.  Handles the built-in action types;
 * custom webhooks are logged but not dispatched (requires HTTP client
 * integration).
 */
async function executeSystemNode(
  node: WorkflowNode,
  instanceId: string
): Promise<void> {
  const data = node.data;
  const actionType = (data.actionType as string) ?? "";
  const actionConfig =
    (data.actionConfig as Record<string, unknown>) ?? {};

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
          logger.info("System node updated document status", {
            action: "executeSystemNode",
            instanceId,
            documentId: instance.documentId,
            newStatus: String(actionConfig.status),
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
          const existing =
            (doc?.metadata as Record<string, unknown>) ?? {};
          await db.document.update({
            where: { id: instance.documentId },
            data: {
              metadata: {
                ...existing,
                ...(actionConfig.metadata as Record<string, unknown>),
              } as object,
            },
          });
        }
        break;
      }

      case "create_notification": {
        if (instance?.initiatedById) {
          await notify(
            instance.initiatedById,
            (actionConfig.title as string) ?? "System Notification",
            (actionConfig.body as string) ?? `Automated notification for "${instance.subject}".`
          );
        }
        break;
      }

      case "assign_classification": {
        if (instance?.documentId && actionConfig.classificationNodeId) {
          await db.document.update({
            where: { id: instance.documentId },
            data: {
              classificationNodeId: actionConfig.classificationNodeId as string,
            },
          });
        }
        break;
      }

      case "send_webhook": {
        // Webhook dispatch is a future extension.  Log the intent.
        logger.info("System node webhook -- not dispatched (not implemented)", {
          action: "executeSystemNode",
          instanceId,
          nodeId: node.id,
          url: actionConfig.url,
        });
        break;
      }

      default:
        logger.warn(`Unknown system action type: ${actionType}`, {
          action: "executeSystemNode",
          instanceId,
          nodeId: node.id,
        });
    }
  } catch (error) {
    logger.error("System node execution failed", error, {
      action: "executeSystemNode",
      instanceId,
      nodeId: node.id,
      actionType,
    });
  }
}
