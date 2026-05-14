/**
 * Simple BFS-based layered auto-layout for the workflow designer.
 *
 * Nodes are assigned to layers by BFS depth from the start node(s).
 * Within a layer they are spaced horizontally; layers stack vertically.
 *
 * Lightweight on purpose — workflows are typically <50 nodes, so a
 * full dagre / elkjs pull is overkill. Edge crossings aren't minimised;
 * if that ever becomes a real complaint we'll pull in dagre.
 */

import type { Edge, Node } from "reactflow";

interface LayoutOpts {
  /** Vertical distance between layers. */
  ySpacing?: number;
  /** Horizontal distance between sibling nodes in a layer. */
  xSpacing?: number;
  /** Top-left origin of the layout. */
  originX?: number;
  originY?: number;
}

export function autoLayoutNodes(
  nodes: Node[],
  edges: Edge[],
  opts: LayoutOpts = {}
): Node[] {
  const ySpacing = opts.ySpacing ?? 140;
  const xSpacing = opts.xSpacing ?? 220;
  const originX = opts.originX ?? 80;
  const originY = opts.originY ?? 60;

  if (nodes.length === 0) return nodes;

  // Build adjacency from edges.
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (outgoing.has(e.source)) outgoing.get(e.source)!.push(e.target);
    if (incoming.has(e.target)) incoming.get(e.target)!.push(e.source);
  }

  // Roots: prefer explicit start nodes; otherwise nodes with no incoming.
  const roots: string[] = nodes
    .filter((n) => n.type === "start")
    .map((n) => n.id);
  if (roots.length === 0) {
    for (const n of nodes) {
      if ((incoming.get(n.id) ?? []).length === 0) roots.push(n.id);
    }
  }
  if (roots.length === 0 && nodes.length > 0) {
    // Fully cyclic graph — fall back to the first node.
    roots.push(nodes[0].id);
  }

  // Assign each node a depth via BFS. Nodes reached via multiple paths
  // take the maximum depth so they sit *below* all their predecessors.
  const depth = new Map<string, number>();
  for (const r of roots) depth.set(r, 0);

  // Iterate to fixpoint (at most nodes.length passes for acyclic graphs).
  let changed = true;
  let pass = 0;
  while (changed && pass < nodes.length + 1) {
    changed = false;
    pass += 1;
    for (const n of nodes) {
      const d = depth.get(n.id);
      if (d === undefined) continue;
      for (const next of outgoing.get(n.id) ?? []) {
        const nextDepth = (depth.get(next) ?? -1);
        if (nextDepth < d + 1) {
          depth.set(next, d + 1);
          changed = true;
        }
      }
    }
  }

  // Unreached nodes (orphans) — drop them in their own column to the side.
  for (const n of nodes) {
    if (!depth.has(n.id)) depth.set(n.id, Number.MAX_SAFE_INTEGER);
  }

  // Group nodes by depth.
  const layers = new Map<number, Node[]>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(n);
  }

  // Order each layer by the average x of its predecessors (mild
  // crossing reduction); orphans get sorted by id.
  const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
  const positionedX = new Map<string, number>();

  for (const d of sortedDepths) {
    const layer = layers.get(d)!;
    layer.sort((a, b) => {
      const ax = avg(
        (incoming.get(a.id) ?? [])
          .map((p) => positionedX.get(p))
          .filter((v): v is number => v !== undefined)
      );
      const bx = avg(
        (incoming.get(b.id) ?? [])
          .map((p) => positionedX.get(p))
          .filter((v): v is number => v !== undefined)
      );
      if (Number.isFinite(ax) && Number.isFinite(bx)) return ax - bx;
      return a.id.localeCompare(b.id);
    });

    const layerWidth = (layer.length - 1) * xSpacing;
    let x = originX - layerWidth / 2;
    for (const n of layer) {
      positionedX.set(n.id, x);
      x += xSpacing;
    }
  }

  // Emit new nodes with computed positions; preserve other fields.
  return nodes.map((n) => {
    const d = depth.get(n.id)!;
    const x = positionedX.get(n.id) ?? originX;
    const y = originY + d * ySpacing;
    return { ...n, position: { x, y } };
  });
}

function avg(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
