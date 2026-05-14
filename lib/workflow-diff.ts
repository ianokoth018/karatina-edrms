/**
 * Compute a structural diff between two workflow definitions.
 *
 * Used by the designer's version history panel to show what changed
 * between published revisions. Pure — no React Flow imports beyond
 * the type aliases so this can run server-side too if we ever need
 * to render a diff in an email or PDF.
 */

import type { Edge, Node } from "reactflow";

export interface NodeFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface NodeChange {
  id: string;
  label: string;
  type: string | undefined;
  fields: NodeFieldChange[];
}

export interface EdgeChange {
  id: string;
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
}

export interface WorkflowDiff {
  addedNodes: Node[];
  removedNodes: Node[];
  changedNodes: NodeChange[];
  addedEdges: EdgeChange[];
  removedEdges: EdgeChange[];
  summary: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesChanged: number;
    edgesAdded: number;
    edgesRemoved: number;
  };
}

export function diffWorkflows(
  before: { nodes: Node[]; edges: Edge[] },
  after: { nodes: Node[]; edges: Edge[] }
): WorkflowDiff {
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));

  const addedNodes: Node[] = [];
  const removedNodes: Node[] = [];
  const changedNodes: NodeChange[] = [];

  for (const [id, afterNode] of afterNodes) {
    if (!beforeNodes.has(id)) {
      addedNodes.push(afterNode);
      continue;
    }
    const beforeNode = beforeNodes.get(id)!;
    const fields = diffNodeData(beforeNode, afterNode);
    if (fields.length > 0) {
      changedNodes.push({
        id,
        label: labelOf(afterNode),
        type: afterNode.type,
        fields,
      });
    }
  }

  for (const [id, beforeNode] of beforeNodes) {
    if (!afterNodes.has(id)) {
      removedNodes.push(beforeNode);
    }
  }

  // Edges — identify by source+sourceHandle+target+targetHandle, ignoring
  // the React Flow id (which may regenerate between saves).
  const edgeKey = (e: Edge) =>
    `${e.source}|${e.sourceHandle ?? ""}|${e.target}|${e.targetHandle ?? ""}`;
  const beforeEdges = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const afterEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));

  function describeEdge(
    e: Edge,
    nodes: Map<string, Node>
  ): EdgeChange {
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceLabel: labelOf(nodes.get(e.source)) ?? e.source,
      targetLabel: labelOf(nodes.get(e.target)) ?? e.target,
    };
  }

  const addedEdges: EdgeChange[] = [];
  const removedEdges: EdgeChange[] = [];
  for (const [k, e] of afterEdges) {
    if (!beforeEdges.has(k)) addedEdges.push(describeEdge(e, afterNodes));
  }
  for (const [k, e] of beforeEdges) {
    if (!afterEdges.has(k)) removedEdges.push(describeEdge(e, beforeNodes));
  }

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    summary: {
      nodesAdded: addedNodes.length,
      nodesRemoved: removedNodes.length,
      nodesChanged: changedNodes.length,
      edgesAdded: addedEdges.length,
      edgesRemoved: removedEdges.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function labelOf(n: Node | undefined): string {
  if (!n) return "";
  const lbl = (n.data?.label as string | undefined)?.trim();
  return lbl && lbl.length > 0 ? lbl : `${n.type ?? "Node"} (${n.id.slice(0, 6)})`;
}

/** Compare node.data field-by-field, plus position changes (we report
 *  position drift as a single "position" field rather than x/y separately
 *  so a pure layout shift doesn't drown the real changes). */
function diffNodeData(before: Node, after: Node): NodeFieldChange[] {
  const out: NodeFieldChange[] = [];
  const beforeData = (before.data ?? {}) as Record<string, unknown>;
  const afterData = (after.data ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.keys(beforeData),
    ...Object.keys(afterData),
  ]);
  // Don't surface the transient runtime overlay as a real change.
  keys.delete("__runtime");
  for (const k of keys) {
    if (!deepEqual(beforeData[k], afterData[k])) {
      out.push({ field: k, before: beforeData[k], after: afterData[k] });
    }
  }
  if (
    before.position &&
    after.position &&
    (Math.round(before.position.x) !== Math.round(after.position.x) ||
      Math.round(before.position.y) !== Math.round(after.position.y))
  ) {
    out.push({
      field: "position",
      before: before.position,
      after: after.position,
    });
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ks = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of ks) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
