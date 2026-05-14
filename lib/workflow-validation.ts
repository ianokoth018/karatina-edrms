/**
 * Pre-publish validator for workflow designer graphs.
 *
 * Pure: takes the React Flow nodes + edges, returns a flat list of issues.
 * Each issue points at a `nodeId` (or `edgeId`) so the UI can scroll-to /
 * highlight the offending element when the user clicks it.
 *
 *   error   — blocks publish (the workflow cannot run reliably)
 *   warning — non-blocking (suspicious but technically valid)
 */

import type { Edge, Node } from "reactflow";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "MISSING_START"
  | "MULTIPLE_STARTS"
  | "MISSING_END"
  | "ORPHAN_NODE"
  | "UNREACHABLE_FROM_START"
  | "DEAD_END"
  | "DANGLING_EDGE"
  | "DECISION_NEEDS_OUTGOING"
  | "DECISION_NEEDS_LABEL"
  | "TASK_NEEDS_ASSIGNEE"
  | "TASK_NEEDS_LABEL"
  | "EMAIL_NEEDS_SUBJECT"
  | "EMAIL_NEEDS_BODY"
  | "TIMER_NEEDS_DURATION"
  | "WAIT_SIGNAL_NEEDS_NAME"
  | "SUBPROCESS_NEEDS_TEMPLATE"
  | "PARALLEL_FORK_NEEDS_BRANCHES"
  | "PARALLEL_JOIN_NEEDS_INPUTS"
  | "PARALLEL_FORK_WITHOUT_JOIN"
  | "DUPLICATE_LABEL"
  | "SELF_LOOP";

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  /** Node this issue is attached to (most issues). */
  nodeId?: string;
  /** Edge this issue is attached to (dangling edge only). */
  edgeId?: string;
}

/* ------------------------------------------------------------------ */
/*  Public entry                                                       */
/* ------------------------------------------------------------------ */

export function validateWorkflow(
  nodes: Node[],
  edges: Edge[]
): Issue[] {
  const issues: Issue[] = [];

  const startNodes = nodes.filter((n) => n.type === "start");
  const endNodes = nodes.filter((n) => n.type === "end");

  // ── Start / End cardinality ────────────────────────────────────────
  if (startNodes.length === 0) {
    issues.push({
      code: "MISSING_START",
      severity: "error",
      message: "Workflow has no Start node.",
    });
  } else if (startNodes.length > 1) {
    for (const n of startNodes.slice(1)) {
      issues.push({
        code: "MULTIPLE_STARTS",
        severity: "error",
        message: "Only one Start node is allowed.",
        nodeId: n.id,
      });
    }
  }
  if (endNodes.length === 0) {
    issues.push({
      code: "MISSING_END",
      severity: "warning",
      message: "Workflow has no End node — instances will not auto-complete.",
    });
  }

  // ── Edge integrity ─────────────────────────────────────────────────
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      issues.push({
        code: "DANGLING_EDGE",
        severity: "error",
        message: "Edge points to a node that no longer exists.",
        edgeId: e.id,
      });
    }
    if (e.source === e.target) {
      issues.push({
        code: "SELF_LOOP",
        severity: "warning",
        message: "Node connects to itself.",
        nodeId: e.source,
      });
    }
  }

  // ── Connectivity (reachability from start, ability to reach end) ──
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      outgoing.get(e.source)!.push(e.target);
      incoming.get(e.target)!.push(e.source);
    }
  }

  const reachableFromStart = new Set<string>();
  if (startNodes.length === 1) {
    const queue = [startNodes[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachableFromStart.has(id)) continue;
      reachableFromStart.add(id);
      for (const next of outgoing.get(id) ?? []) queue.push(next);
    }
  }

  const canReachEnd = new Set<string>();
  if (endNodes.length > 0) {
    const queue = endNodes.map((n) => n.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (canReachEnd.has(id)) continue;
      canReachEnd.add(id);
      for (const prev of incoming.get(id) ?? []) queue.push(prev);
    }
  }

  for (const n of nodes) {
    if (n.type === "start") continue;
    const hasIncoming = (incoming.get(n.id)?.length ?? 0) > 0;
    const hasOutgoing = (outgoing.get(n.id)?.length ?? 0) > 0;

    if (!hasIncoming && !hasOutgoing) {
      issues.push({
        code: "ORPHAN_NODE",
        severity: "error",
        message: `${labelOf(n)} is not connected to anything.`,
        nodeId: n.id,
      });
      continue;
    }

    if (startNodes.length === 1 && !reachableFromStart.has(n.id)) {
      issues.push({
        code: "UNREACHABLE_FROM_START",
        severity: "error",
        message: `${labelOf(n)} cannot be reached from Start.`,
        nodeId: n.id,
      });
    }

    if (
      n.type !== "end" &&
      endNodes.length > 0 &&
      !canReachEnd.has(n.id)
    ) {
      issues.push({
        code: "DEAD_END",
        severity: "warning",
        message: `${labelOf(n)} has no path to an End node.`,
        nodeId: n.id,
      });
    }
  }

  // ── Per-node configuration checks ──────────────────────────────────
  const labelCounts = new Map<string, number>();
  for (const n of nodes) {
    const lbl = String(n.data?.label ?? "").trim().toLowerCase();
    if (lbl) labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
  }

  for (const n of nodes) {
    const lbl = String(n.data?.label ?? "").trim();

    if (lbl && (labelCounts.get(lbl.toLowerCase()) ?? 0) > 1) {
      issues.push({
        code: "DUPLICATE_LABEL",
        severity: "warning",
        message: `Another node also uses the label "${lbl}".`,
        nodeId: n.id,
      });
    }

    switch (n.type) {
      case "task":
        validateTask(n, issues);
        break;
      case "decision":
        validateDecision(n, outgoing.get(n.id) ?? [], edges, issues);
        break;
      case "email":
        validateEmail(n, issues);
        break;
      case "timer":
        validateTimer(n, issues);
        break;
      case "wait_signal":
        validateWaitSignal(n, issues);
        break;
      case "subprocess":
        validateSubprocess(n, issues);
        break;
      case "parallel":
        validateParallel(n, outgoing.get(n.id) ?? [], incoming.get(n.id) ?? [], issues);
        break;
    }
  }

  // ── Fork must have a matching downstream join ──────────────────────
  const forks = nodes.filter(
    (n) => n.type === "parallel" && (n.data as { gatewayType?: string })?.gatewayType === "fork"
  );
  const joins = new Set(
    nodes
      .filter(
        (n) => n.type === "parallel" && (n.data as { gatewayType?: string })?.gatewayType === "join"
      )
      .map((n) => n.id)
  );
  for (const fork of forks) {
    if (!hasReachableJoin(fork.id, outgoing, joins)) {
      issues.push({
        code: "PARALLEL_FORK_WITHOUT_JOIN",
        severity: "warning",
        message: `${labelOf(fork)} has no matching downstream Join — branches may never reconverge.`,
        nodeId: fork.id,
      });
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/*  Per-node validators                                                */
/* ------------------------------------------------------------------ */

function validateTask(n: Node, issues: Issue[]) {
  const data = n.data as {
    label?: string;
    assigneeRule?: string;
    assigneeValue?: string;
    poolId?: string;
  };
  if (!data.label?.trim()) {
    issues.push({
      code: "TASK_NEEDS_LABEL",
      severity: "error",
      message: "Task needs a label.",
      nodeId: n.id,
    });
  }
  const rule = data.assigneeRule;
  const needsValue =
    rule === "specific_user" || rule === "role_based" || rule === "department";
  if (needsValue && !data.assigneeValue?.trim()) {
    issues.push({
      code: "TASK_NEEDS_ASSIGNEE",
      severity: "error",
      message: `${labelOf(n)} needs an assignee for rule "${rule}".`,
      nodeId: n.id,
    });
  }
  if (rule === "pool" && !data.poolId?.trim()) {
    issues.push({
      code: "TASK_NEEDS_ASSIGNEE",
      severity: "error",
      message: `${labelOf(n)} needs a pool selection.`,
      nodeId: n.id,
    });
  }
}

function validateDecision(
  n: Node,
  outIds: string[],
  edges: Edge[],
  issues: Issue[]
) {
  const data = n.data as { label?: string; conditions?: unknown[] };
  if (!data.label?.trim()) {
    issues.push({
      code: "DECISION_NEEDS_LABEL",
      severity: "warning",
      message: "Decision node has no label.",
      nodeId: n.id,
    });
  }
  if (outIds.length < 2) {
    issues.push({
      code: "DECISION_NEEDS_OUTGOING",
      severity: "error",
      message: `${labelOf(n)} should have at least two outgoing edges (Yes and No).`,
      nodeId: n.id,
    });
    return;
  }
  // Need at least one rule OR an explicit defaultHandle: otherwise we
  // can route off the handle id alone (yes/no edges). Check that the
  // outgoing handles actually used cover yes + no, OR that conditions
  // exist.
  const handles = new Set(
    edges
      .filter((e) => e.source === n.id)
      .map((e) => e.sourceHandle ?? "")
  );
  const hasConditions = Array.isArray(data.conditions) && data.conditions.length > 0;
  if (!hasConditions && !(handles.has("yes") && handles.has("no"))) {
    issues.push({
      code: "DECISION_NEEDS_OUTGOING",
      severity: "warning",
      message: `${labelOf(n)} has no condition rules and is missing one of the Yes/No paths.`,
      nodeId: n.id,
    });
  }
}

function validateEmail(n: Node, issues: Issue[]) {
  const data = n.data as { subject?: string; bodyTemplate?: string };
  if (!data.subject?.trim()) {
    issues.push({
      code: "EMAIL_NEEDS_SUBJECT",
      severity: "error",
      message: `${labelOf(n)} needs an email subject.`,
      nodeId: n.id,
    });
  }
  if (!data.bodyTemplate?.trim()) {
    issues.push({
      code: "EMAIL_NEEDS_BODY",
      severity: "warning",
      message: `${labelOf(n)} has an empty body template.`,
      nodeId: n.id,
    });
  }
}

function validateTimer(n: Node, issues: Issue[]) {
  const data = n.data as {
    timerType?: string;
    durationDays?: number;
    durationHours?: number;
    targetDate?: string;
  };
  const type = data.timerType ?? "duration";
  if (type === "date") {
    if (!data.targetDate?.trim()) {
      issues.push({
        code: "TIMER_NEEDS_DURATION",
        severity: "error",
        message: `${labelOf(n)} needs a target date.`,
        nodeId: n.id,
      });
    }
  } else {
    const days = Number(data.durationDays ?? 0);
    const hours = Number(data.durationHours ?? 0);
    if (days <= 0 && hours <= 0) {
      issues.push({
        code: "TIMER_NEEDS_DURATION",
        severity: "error",
        message: `${labelOf(n)} needs a non-zero duration.`,
        nodeId: n.id,
      });
    }
  }
}

function validateWaitSignal(n: Node, issues: Issue[]) {
  const data = n.data as { signalName?: string };
  if (!data.signalName?.trim()) {
    issues.push({
      code: "WAIT_SIGNAL_NEEDS_NAME",
      severity: "error",
      message: `${labelOf(n)} needs a signal name.`,
      nodeId: n.id,
    });
  }
}

function validateSubprocess(n: Node, issues: Issue[]) {
  const data = n.data as { templateId?: string };
  if (!data.templateId?.trim()) {
    issues.push({
      code: "SUBPROCESS_NEEDS_TEMPLATE",
      severity: "error",
      message: `${labelOf(n)} needs a sub-workflow template.`,
      nodeId: n.id,
    });
  }
}

function validateParallel(
  n: Node,
  outIds: string[],
  inIds: string[],
  issues: Issue[]
) {
  const data = n.data as { gatewayType?: string };
  if (data.gatewayType === "fork" && outIds.length < 2) {
    issues.push({
      code: "PARALLEL_FORK_NEEDS_BRANCHES",
      severity: "error",
      message: `${labelOf(n)} (fork) needs at least 2 outgoing branches.`,
      nodeId: n.id,
    });
  }
  if (data.gatewayType === "join" && inIds.length < 2) {
    issues.push({
      code: "PARALLEL_JOIN_NEEDS_INPUTS",
      severity: "error",
      message: `${labelOf(n)} (join) needs at least 2 incoming branches.`,
      nodeId: n.id,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function labelOf(n: Node): string {
  const lbl = String(n.data?.label ?? "").trim();
  if (lbl) return `"${lbl}"`;
  return `${n.type ?? "Node"} (${n.id.slice(0, 8)})`;
}

function hasReachableJoin(
  startId: string,
  outgoing: Map<string, string[]>,
  joins: Set<string>
): boolean {
  const seen = new Set<string>([startId]);
  const queue = [...(outgoing.get(startId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (joins.has(id)) return true;
    for (const next of outgoing.get(id) ?? []) queue.push(next);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Convenience aggregates                                             */
/* ------------------------------------------------------------------ */

export function countBySeverity(issues: Issue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
