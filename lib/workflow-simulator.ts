// ---------------------------------------------------------------------------
// Workflow Simulator
// ---------------------------------------------------------------------------
// Pure (no DB, no I/O) traversal of a workflow definition that lets a user
// dry-run their template against sample form data BEFORE publishing. Mirrors
// the routing logic of lib/workflow-engine.ts but skips all side effects:
//   - Task nodes log "would create task" and follow the first outgoing edge
//   - Email / HTTP / System nodes log "would execute" — no real send/fetch
//   - Timers fire instantly
//   - Wait-signal nodes record a stop point and end the trace
//
// Returns a structured trace the designer can render.
// ---------------------------------------------------------------------------

import { evaluateConditions } from "@/lib/workflow-engine";
import { interpolate } from "@/lib/mailer";

interface SimNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface SimEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

interface SimDefinition {
  nodes: SimNode[];
  edges: SimEdge[];
}

export interface TraceStep {
  nodeId: string;
  nodeType: string;
  label: string;
  /** Human-readable summary of what happened at this node. */
  detail: string;
  /** Outgoing edge handle taken (when applicable). */
  handle?: string;
  /** Variables added or changed at this node. */
  varsChanged?: Record<string, unknown>;
  /** Hint that this node would block in production (task, signal). */
  blocked?: boolean;
  /** Hint that the simulator skipped real side effects here. */
  skipped?: boolean;
}

export interface SimulationResult {
  ok: boolean;
  steps: TraceStep[];
  /** Final workflow variables after simulation. */
  finalData: Record<string, unknown>;
  /** Reason simulation stopped (END node, blocking node, no outgoing edge). */
  terminator: string;
  /** Validation warnings — missing start, dangling edges, etc. */
  warnings: string[];
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

const MAX_STEPS = 500;

export function simulateWorkflow(
  definition: SimDefinition,
  formData: Record<string, unknown> = {}
): SimulationResult {
  const steps: TraceStep[] = [];
  const warnings: string[] = [];

  if (!definition.nodes || definition.nodes.length === 0) {
    return {
      ok: false,
      steps,
      finalData: {},
      terminator: "no_nodes",
      warnings: ["Workflow has no nodes."],
    };
  }

  const startNodes = definition.nodes.filter((n) => n.type === "start");
  if (startNodes.length === 0) {
    return {
      ok: false,
      steps,
      finalData: formData,
      terminator: "no_start",
      warnings: ["Workflow has no start node."],
    };
  }
  if (startNodes.length > 1) {
    warnings.push(
      `Workflow has ${startNodes.length} start nodes — simulator follows the first.`
    );
  }

  // Apply start-node variable defaults so the trace reflects production
  // bootstrap behaviour.
  const data: Record<string, unknown> = { ...formData, _actor: "(simulator)" };
  const defaults =
    (startNodes[0].data as {
      variableDefaults?: { name: string; value: string }[];
    })?.variableDefaults ?? [];
  const stringVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(formData)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      stringVars[k] = String(v);
    }
  }
  for (const d of defaults) {
    if (!d.name) continue;
    if (!(d.name in data)) {
      data[d.name] = interpolate(d.value, stringVars);
    }
  }

  const nodeById = new Map(definition.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  let terminator = "ok";

  function walk(nodeId: string, fromHandle?: string): boolean {
    if (steps.length >= MAX_STEPS) {
      warnings.push("Step limit reached — possible infinite loop.");
      terminator = "step_limit";
      return false;
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      warnings.push(`Edge target ${nodeId} not found.`);
      return false;
    }
    if (visited.has(nodeId)) {
      // Allow revisits for parallel-fork rejoins but warn about cycles.
      // Real cycle protection happens via the step limit.
    }
    visited.add(nodeId);

    const label = (node.data.label as string) ?? node.type;
    const before = JSON.stringify(data);

    let nextHandle: string | undefined;
    let detail = "";
    let blocked = false;
    let skipped = false;

    switch (node.type) {
      case "start":
        detail = "Workflow start.";
        break;

      case "end":
        detail = `End — outcome: ${node.data.outcome ?? "completed"}`;
        steps.push({
          nodeId,
          nodeType: node.type,
          label,
          detail,
          handle: fromHandle,
        });
        terminator = "end";
        return true;

      case "decision": {
        const conds =
          (node.data.conditions as (Condition | ConditionGroup)[] | undefined) ??
          [];
        const matched = evaluateConditions(conds, data);
        const outEdges = definition.edges.filter((e) => e.source === nodeId);
        const outHandles = outEdges.map((e) => e.sourceHandle ?? "");
        const configuredDefault =
          (node.data.defaultHandle as string | undefined) ?? null;
        nextHandle =
          matched ??
          (configuredDefault && outHandles.includes(configuredDefault)
            ? configuredDefault
            : undefined) ??
          (outHandles.includes("default") ? "default" : undefined) ??
          (outHandles.includes("yes") ? "yes" : undefined) ??
          outHandles[0] ??
          "default";
        detail = matched
          ? `Condition matched → routes via "${nextHandle}".`
          : `No condition matched → fallback to "${nextHandle}".`;
        break;
      }

      case "task":
        detail = `Would create a task for: ${
          (node.data.assigneeRule as string) ?? "?"
        }${node.data.assigneeValue ? ` (${node.data.assigneeValue})` : ""}.`;
        blocked = true;
        skipped = true;
        break;

      case "email":
        detail = `Would send email to ${
          (node.data.recipientType as string) ?? "?"
        }${
          node.data.recipientDisplayName || node.data.recipientValue
            ? `: ${node.data.recipientDisplayName ?? node.data.recipientValue}`
            : ""
        }.`;
        skipped = true;
        break;

      case "http":
        detail = `Would call ${
          (node.data.method as string) ?? "GET"
        } ${(node.data.url as string) ?? "(no URL)"}.`;
        skipped = true;
        // Default to success path in the simulator.
        nextHandle = "success";
        break;

      case "system": {
        const at = (node.data.actionType as string) ?? "?";
        if (node.data.foreach) {
          const itemsPath = (node.data.foreachItems as string) ?? "";
          const arr = itemsPath
            ? (resolveFieldValue(data, itemsPath) as unknown[])
            : null;
          const count = Array.isArray(arr) ? arr.length : 0;
          detail = Array.isArray(arr)
            ? `Would run system action "${at}" ${count} time${
                count === 1 ? "" : "s"
              } (foreach over ${itemsPath}).`
            : `foreach: ${itemsPath} did not resolve to an array — would run once.`;
        } else {
          detail = `Would run system action: ${at}.`;
        }
        skipped = true;
        break;
      }

      case "timer":
        detail = `Timer (${
          (node.data.timerType as string) ?? "duration"
        }) — fires instantly in simulation.`;
        skipped = true;
        break;

      case "wait_signal":
        detail = `Would pause and wait for signal "${
          (node.data.signalName as string) ?? "(unnamed)"
        }".`;
        blocked = true;
        skipped = true;
        steps.push({
          nodeId,
          nodeType: node.type,
          label,
          detail,
          handle: fromHandle,
          blocked,
          skipped,
        });
        terminator = "wait_signal";
        return false;

      case "parallel": {
        const gatewayType = (node.data.gatewayType as string) ?? "fork";
        if (gatewayType === "fork") {
          detail = "Fork — would run all outgoing branches in parallel.";
        } else {
          detail = `Join (${(node.data.joinRule as string) ?? "all"}).`;
        }
        break;
      }

      case "subprocess":
        detail = `Would start subprocess: ${
          (node.data.subTemplateId as string) ?? "(no template)"
        }.`;
        skipped = true;
        break;

      default:
        detail = `Unknown node type "${node.type}".`;
        warnings.push(detail);
        skipped = true;
    }

    const after = JSON.stringify(data);
    const varsChanged =
      after !== before ? diffVars(JSON.parse(before), data) : undefined;

    steps.push({
      nodeId,
      nodeType: node.type,
      label,
      detail,
      handle: fromHandle,
      varsChanged,
      blocked,
      skipped,
    });

    // Find outgoing edges. For decision / http we routed via a specific
    // handle; for fork-parallel we walk every outgoing edge.
    const out = definition.edges.filter((e) => e.source === nodeId);
    if (out.length === 0) {
      warnings.push(`Node "${label}" (${nodeId}) has no outgoing edge.`);
      terminator = "dangling";
      return false;
    }

    if (node.type === "parallel" && (node.data.gatewayType ?? "fork") === "fork") {
      for (const edge of out) {
        const cont = walk(edge.target, edge.sourceHandle ?? undefined);
        if (!cont && terminator !== "ok" && terminator !== "end") return false;
      }
      return true;
    }

    const chosenEdge =
      out.find((e) => (e.sourceHandle ?? "") === (nextHandle ?? "")) ?? out[0];
    return walk(chosenEdge.target, chosenEdge.sourceHandle ?? undefined);
  }

  walk(startNodes[0].id);

  return {
    ok: terminator === "end" || terminator === "wait_signal",
    steps,
    finalData: data,
    terminator,
    warnings,
  };
}

function resolveFieldValue(
  data: Record<string, unknown>,
  field: string
): unknown {
  return field.split(".").reduce<unknown>((cur, part) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[part];
  }, data);
}

function diffVars(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) {
      out[k] = after[k];
    }
  }
  return out;
}
