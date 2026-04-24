"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import {
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from "reactflow";
import NodePalette from "@/components/workflow/node-palette";
import NodeConfigPanel from "@/components/workflow/node-config-panel";

const WorkflowCanvas = dynamic(() => import("@/components/workflow/canvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <svg
          className="animate-spin h-8 w-8 text-karu-green mx-auto mb-3"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Loading workflow designer...
        </p>
      </div>
    </div>
  ),
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  version: number;
  isActive: boolean;
  definition: {
    nodes?: Node[];
    edges?: Edge[];
    steps?: { index: number; name: string; type: string }[];
  };
}

interface ValidationIssue {
  nodeId?: string;
  severity: "error" | "warning";
  message: string;
}

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

const defaultNodes: Node[] = [
  {
    id: "start_1",
    type: "start",
    position: { x: 250, y: 50 },
    data: {},
  },
];

const defaultEdges: Edge[] = [];

/* Edge color reference for typed edges:
 * approval: #22c55e (green), rejection: #ef4444 (red),
 * default: #3b82f6 (blue), timeout: #eab308 (yellow)
 */

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function WorkflowDesignerPage() {
  const { data: session } = useSession();

  // ---- Canvas state ----
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // ---- Template state ----
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateVersion, setTemplateVersion] = useState<number>(1);
  const [isPublished, setIsPublished] = useState(false);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(
    []
  );
  const [, setHighlightedNodes] = useState<Set<string>>(
    new Set()
  );
  const [publishing, setPublishing] = useState(false);
  const [showLoadDropdown, setShowLoadDropdown] = useState(false);
  const loadDropdownRef = useRef<HTMLDivElement>(null);

  // Open panels by default on desktop, closed on mobile
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setLeftPanelOpen(true);
      setRightPanelOpen(true);
    }
  }, []);

  // ---- Undo/Redo history ----
  const historyRef = useRef<HistoryEntry[]>([
    { nodes: defaultNodes, edges: defaultEdges },
  ]);
  const historyIndexRef = useRef(0);
  const isUndoRedoRef = useRef(false);

  const hasPermission = session?.user?.permissions?.includes("workflows:manage");

  // ---- Snapshot for undo/redo ----
  const pushHistory = useCallback(
    (n: Node[], e: Edge[]) => {
      if (isUndoRedoRef.current) return;
      const current = historyRef.current;
      // Trim any redo entries
      historyRef.current = current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push({
        nodes: n.map((nd) => ({ ...nd, data: { ...nd.data } })),
        edges: e.map((ed) => ({ ...ed })),
      });
      // Cap at 50 entries
      if (historyRef.current.length > 50) {
        historyRef.current = historyRef.current.slice(-50);
      }
      historyIndexRef.current = historyRef.current.length - 1;
    },
    []
  );

  // Track unsaved changes
  const savedSnapshotRef = useRef<string>("");

  const currentSnapshot = useMemo(() => {
    return JSON.stringify({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
      templateName,
      templateDescription,
    });
  }, [nodes, edges, templateName, templateDescription]);

  useEffect(() => {
    setHasUnsavedChanges(currentSnapshot !== savedSnapshotRef.current);
  }, [currentSnapshot]);

  // Record history on node/edge changes (debounced)
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isUndoRedoRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      pushHistory(nodes, edges);
    }, 400);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [nodes, edges, pushHistory]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo =
    historyIndexRef.current < historyRef.current.length - 1;

  function handleUndo() {
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current -= 1;
    const entry = historyRef.current[historyIndexRef.current];
    setNodes(entry.nodes.map((n) => ({ ...n, data: { ...n.data } })));
    setEdges(entry.edges.map((e) => ({ ...e })));
    setSelectedNode(null);
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }

  function handleRedo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current += 1;
    const entry = historyRef.current[historyIndexRef.current];
    setNodes(entry.nodes.map((n) => ({ ...n, data: { ...n.data } })));
    setEdges(entry.edges.map((e) => ({ ...e })));
    setSelectedNode(null);
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === "z" && e.shiftKey) || e.key === "y")
      ) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close load dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        loadDropdownRef.current &&
        !loadDropdownRef.current.contains(e.target as HTMLElement)
      ) {
        setShowLoadDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* ================================================================== */
  /*  API helpers                                                        */
  /* ================================================================== */

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/workflows/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  /* ================================================================== */
  /*  Node helpers                                                       */
  /* ================================================================== */

  const handleUpdateNodeData = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds: Node[]) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: newData } : n))
      );
      setSelectedNode((prev) =>
        prev && prev.id === nodeId ? { ...prev, data: newData } : prev
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds: Node[]) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds: Edge[]) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const handleNodeSelect = useCallback(
    (node: Node | null) => {
      setSelectedNode(node);
      if (node && !rightPanelOpen) {
        setRightPanelOpen(true);
      }
    },
    [rightPanelOpen]
  );

  /* ================================================================== */
  /*  Canvas operations                                                  */
  /* ================================================================== */

  function handleClear() {
    if (
      !confirm(
        "Clear the canvas? This will remove all nodes and connections."
      )
    )
      return;
    setNodes(defaultNodes);
    setEdges(defaultEdges);
    setSelectedNode(null);
    setTemplateId(null);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateVersion(1);
    setIsPublished(false);
    setValidationIssues([]);
    setHighlightedNodes(new Set());
    setShowValidationPanel(false);
    savedSnapshotRef.current = "";
    historyRef.current = [{ nodes: defaultNodes, edges: defaultEdges }];
    historyIndexRef.current = 0;
  }

  // Auto-layout: arrange nodes in a top-down tree layout
  function handleAutoLayout() {
    // Build adjacency from edges
    const adj: Record<string, string[]> = {};
    const inDeg: Record<string, number> = {};
    for (const n of nodes) {
      adj[n.id] = [];
      inDeg[n.id] = 0;
    }
    for (const e of edges) {
      if (adj[e.source]) adj[e.source].push(e.target);
      inDeg[e.target] = (inDeg[e.target] ?? 0) + 1;
    }

    // BFS level assignment
    const levels: Record<string, number> = {};
    const queue: string[] = [];
    // Start from nodes with no incoming edges
    for (const n of nodes) {
      if ((inDeg[n.id] ?? 0) === 0) {
        queue.push(n.id);
        levels[n.id] = 0;
      }
    }

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const children = adj[cur] ?? [];
      for (const child of children) {
        const newLevel = (levels[cur] ?? 0) + 1;
        if (levels[child] === undefined || levels[child] < newLevel) {
          levels[child] = newLevel;
        }
        inDeg[child] = (inDeg[child] ?? 1) - 1;
        if (inDeg[child] === 0) {
          queue.push(child);
        }
      }
    }

    // Assign positions if node still has no level (disconnected)
    let maxLevel = 0;
    for (const n of nodes) {
      if (levels[n.id] === undefined) {
        maxLevel += 1;
        levels[n.id] = maxLevel;
      } else if (levels[n.id] > maxLevel) {
        maxLevel = levels[n.id];
      }
    }

    // Group nodes by level
    const byLevel: Record<number, string[]> = {};
    for (const n of nodes) {
      const lvl = levels[n.id] ?? 0;
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push(n.id);
    }

    const VERTICAL_GAP = 150;
    const HORIZONTAL_GAP = 220;

    setNodes((nds: Node[]) =>
      nds.map((n) => {
        const lvl = levels[n.id] ?? 0;
        const siblings = byLevel[lvl] ?? [n.id];
        const idx = siblings.indexOf(n.id);
        const totalWidth = (siblings.length - 1) * HORIZONTAL_GAP;
        const startX = 400 - totalWidth / 2;
        return {
          ...n,
          position: {
            x: startX + idx * HORIZONTAL_GAP,
            y: 60 + lvl * VERTICAL_GAP,
          },
        };
      })
    );
  }

  /* ================================================================== */
  /*  Validation                                                         */
  /* ================================================================== */

  function validateWorkflow(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Build adjacency
    const outgoing: Record<string, string[]> = {};
    const incoming: Record<string, string[]> = {};
    for (const n of nodes) {
      outgoing[n.id] = [];
      incoming[n.id] = [];
    }
    for (const e of edges) {
      if (outgoing[e.source]) outgoing[e.source].push(e.target);
      if (incoming[e.target]) incoming[e.target].push(e.source);
    }

    // 1. Exactly one start node
    const startNodes = nodes.filter((n) => n.type === "start");
    if (startNodes.length === 0) {
      issues.push({
        severity: "error",
        message: "Missing Start node - every workflow needs exactly one",
      });
    } else if (startNodes.length > 1) {
      startNodes.slice(1).forEach((n) =>
        issues.push({
          nodeId: n.id,
          severity: "error",
          message: `Duplicate Start node "${n.id}" - only one is allowed`,
        })
      );
    }

    // 2. At least one end node
    const endNodes = nodes.filter((n) => n.type === "end");
    if (endNodes.length === 0) {
      issues.push({
        severity: "error",
        message: "Missing End node - add at least one to complete the workflow",
      });
    }

    // 3. All nodes connected
    for (const n of nodes) {
      if (n.type === "start") {
        if ((outgoing[n.id] ?? []).length === 0) {
          issues.push({
            nodeId: n.id,
            severity: "error",
            message: "Start node has no outgoing connection",
          });
        }
      } else if (n.type === "end") {
        if ((incoming[n.id] ?? []).length === 0) {
          issues.push({
            nodeId: n.id,
            severity: "warning",
            message: "End node has no incoming connection",
          });
        }
      } else {
        if ((incoming[n.id] ?? []).length === 0) {
          issues.push({
            nodeId: n.id,
            severity: "warning",
            message: `"${n.data?.label || n.type}" has no incoming connection`,
          });
        }
        if ((outgoing[n.id] ?? []).length === 0) {
          issues.push({
            nodeId: n.id,
            severity: "warning",
            message: `"${n.data?.label || n.type}" has no outgoing connection`,
          });
        }
      }
    }

    // 4. Decision nodes should have conditions
    const decisionNodes = nodes.filter((n) => n.type === "decision");
    for (const dn of decisionNodes) {
      const conditions = dn.data?.conditions;
      if (!conditions || (Array.isArray(conditions) && conditions.length === 0)) {
        if (!dn.data?.conditionYes && !dn.data?.conditionNo) {
          issues.push({
            nodeId: dn.id,
            severity: "warning",
            message: `Decision "${dn.data?.label || "Decision"}" has no conditions configured`,
          });
        }
      }
      // Must have at least 2 outgoing edges
      if ((outgoing[dn.id] ?? []).length < 2) {
        issues.push({
          nodeId: dn.id,
          severity: "warning",
          message: `Decision "${dn.data?.label || "Decision"}" should have at least 2 outgoing paths`,
        });
      }
    }

    // 5. Task nodes should have assignee rules
    const taskNodes = nodes.filter((n) => n.type === "task");
    for (const tn of taskNodes) {
      if (!tn.data?.assigneeRule || tn.data.assigneeRule === "dynamic") {
        // dynamic is the default placeholder, might not have actual value
        if (
          tn.data?.assigneeRule === "specific_user" &&
          !tn.data?.assigneeValue
        ) {
          issues.push({
            nodeId: tn.id,
            severity: "warning",
            message: `Task "${tn.data?.label || "Task"}" has no assignee specified`,
          });
        }
      }
    }

    // 6. Reachability from Start
    if (startNodes.length === 1) {
      const reachable = new Set<string>();
      const bfs = [startNodes[0].id];
      while (bfs.length > 0) {
        const cur = bfs.shift()!;
        if (reachable.has(cur)) continue;
        reachable.add(cur);
        for (const child of outgoing[cur] ?? []) {
          if (!reachable.has(child)) bfs.push(child);
        }
      }
      for (const n of nodes) {
        if (!reachable.has(n.id) && n.type !== "start") {
          issues.push({
            nodeId: n.id,
            severity: "error",
            message: `"${n.data?.label || n.type}" is unreachable from Start`,
          });
        }
      }
    }

    return issues;
  }

  function handleValidate() {
    const issues = validateWorkflow();
    setValidationIssues(issues);
    setShowValidationPanel(true);
    // Highlight problematic nodes
    const problemNodeIds = new Set(
      issues.filter((i) => i.nodeId).map((i) => i.nodeId!)
    );
    setHighlightedNodes(problemNodeIds);

    // Apply red border to problematic nodes via class
    setNodes((nds: Node[]) =>
      nds.map((n) => ({
        ...n,
        className: problemNodeIds.has(n.id)
          ? "!ring-2 !ring-red-500 !ring-offset-2 rounded-xl"
          : "",
      }))
    );

    if (issues.length === 0) {
      setSaveMessage({
        type: "success",
        text: "Workflow is valid - no issues found!",
      });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }

  function clearValidationHighlights() {
    setHighlightedNodes(new Set());
    setNodes((nds: Node[]) =>
      nds.map((n) => ({
        ...n,
        className: "",
      }))
    );
  }

  /* ================================================================== */
  /*  Download workflow as image                                         */
  /* ================================================================== */

  async function handleDownloadImage() {
    // Target the viewport pane which contains just the nodes and edges
    const viewport = document.querySelector(".react-flow__viewport") as HTMLElement;
    if (!viewport) return;

    // Temporarily hide minimap and controls for clean export
    const minimap = document.querySelector(".react-flow__minimap") as HTMLElement;
    const controls = document.querySelector(".react-flow__controls") as HTMLElement;
    const panel = document.querySelector(".react-flow__panel") as HTMLElement;
    if (minimap) minimap.style.display = "none";
    if (controls) controls.style.display = "none";
    if (panel) panel.style.display = "none";

    try {
      const { toPng } = await import("html-to-image");
      // Use the parent container for full canvas capture
      const canvas = document.querySelector(".react-flow") as HTMLElement;
      const dataUrl = await toPng(canvas, {
        backgroundColor: document.documentElement.classList.contains("dark")
          ? "#030712"
          : "#ffffff",
        quality: 1,
        pixelRatio: 3, // Higher resolution for readability
        filter: (node) => {
          // Exclude minimap, controls, attribution
          if (node.classList) {
            if (node.classList.contains("react-flow__minimap")) return false;
            if (node.classList.contains("react-flow__controls")) return false;
            if (node.classList.contains("react-flow__panel")) return false;
            if (node.classList.contains("react-flow__attribution")) return false;
          }
          return true;
        },
      });
      const link = document.createElement("a");
      link.download = `${templateName || "workflow"}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      setSaveMessage({ type: "error", text: "Failed to export image" });
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      // Restore hidden elements
      if (minimap) minimap.style.display = "";
      if (controls) controls.style.display = "";
      if (panel) panel.style.display = "";
    }
  }

  /* ================================================================== */
  /*  Template load / save / publish                                     */
  /* ================================================================== */

  async function handleLoadTemplate(id: string) {
    if (!id) return;
    try {
      const res = await fetch(`/api/workflows/templates/${id}`);
      if (!res.ok) throw new Error("Failed to load template");
      const data = await res.json();
      const tmpl = data.template;

      setTemplateId(tmpl.id);
      setTemplateName(tmpl.name);
      setTemplateDescription(tmpl.description ?? "");
      setTemplateVersion(tmpl.version ?? 1);
      setIsPublished(tmpl.isActive ?? false);

      const def = tmpl.definition;

      if (def.nodes && Array.isArray(def.nodes)) {
        setNodes(def.nodes);
        setEdges(def.edges ?? []);
      } else if (def.steps && Array.isArray(def.steps)) {
        // Legacy step-based format conversion
        const convertedNodes: Node[] = [
          {
            id: "start_1",
            type: "start",
            position: { x: 250, y: 50 },
            data: {},
          },
        ];
        const convertedEdges: Edge[] = [];
        let prevNodeId = "start_1";

        def.steps.forEach(
          (
            step: { name: string; type: string; description?: string },
            idx: number
          ) => {
            const nodeId = `task_legacy_${idx}`;
            convertedNodes.push({
              id: nodeId,
              type: "task",
              position: { x: 200, y: 170 + idx * 150 },
              data: {
                label: step.name,
                taskType: step.type || "approval",
                description: step.description || "",
                assigneeRule: "dynamic",
                assigneeValue: "",
                escalationDays: 0,
                requiredAction: "approve",
              },
            });
            convertedEdges.push({
              id: `edge_${prevNodeId}_${nodeId}`,
              source: prevNodeId,
              target: nodeId,
              type: "smoothstep",
              animated: true,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "#02773b",
                width: 20,
                height: 20,
              },
              style: { stroke: "#02773b", strokeWidth: 2 },
            });
            prevNodeId = nodeId;
          }
        );

        const endId = "end_legacy";
        convertedNodes.push({
          id: endId,
          type: "end",
          position: { x: 250, y: 170 + def.steps.length * 150 },
          data: {},
        });
        convertedEdges.push({
          id: `edge_${prevNodeId}_${endId}`,
          source: prevNodeId,
          target: endId,
          type: "smoothstep",
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#02773b",
            width: 20,
            height: 20,
          },
          style: { stroke: "#02773b", strokeWidth: 2 },
        });

        setNodes(convertedNodes);
        setEdges(convertedEdges);
      }

      setSelectedNode(null);
      setShowLoadDropdown(false);

      // Reset history
      const loadedNodes = def.nodes ?? [];
      const loadedEdges = def.edges ?? [];
      historyRef.current = [{ nodes: loadedNodes, edges: loadedEdges }];
      historyIndexRef.current = 0;

      // Mark as saved
      savedSnapshotRef.current = JSON.stringify({
        nodes: (def.nodes ?? []).map(
          (n: { id: string; type: string; position: unknown; data: unknown }) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
          })
        ),
        edges: (def.edges ?? []).map(
          (e: { id: string; source: string; target: string }) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })
        ),
        templateName: tmpl.name,
        templateDescription: tmpl.description ?? "",
      });

      setSaveMessage({ type: "success", text: `Loaded "${tmpl.name}" (v${tmpl.version ?? 1})` });
      setTimeout(() => setSaveMessage(null), 3000);

      // Clear validation
      clearValidationHighlights();
      setValidationIssues([]);
      setShowValidationPanel(false);
    } catch {
      setSaveMessage({ type: "error", text: "Failed to load template" });
    }
  }

  async function handleSave() {
    if (!templateName.trim()) {
      setSaveMessage({ type: "error", text: "Template name is required" });
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    const definition = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
        animated: e.animated,
        markerEnd: e.markerEnd,
        style: e.style,
        label: e.label,
        data: e.data,
      })),
      steps: extractStepsFromFlow(nodes, edges),
    };

    try {
      let res;
      if (templateId) {
        res = await fetch(`/api/workflows/templates/${templateId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            description: templateDescription.trim() || undefined,
            definition,
          }),
        });
      } else {
        res = await fetch("/api/workflows/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            description: templateDescription.trim() || undefined,
            steps:
              definition.steps.length > 0
                ? definition.steps.map((s) => ({ name: s.name, type: s.type }))
                : [{ name: "Default Step", type: "approval" }],
            definition,
          }),
        });
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const result = await res.json();
      if (!templateId && result.template?.id) {
        setTemplateId(result.template.id);
      }
      if (result.template?.version) {
        setTemplateVersion(result.template.version);
      }

      savedSnapshotRef.current = currentSnapshot;
      setSaveMessage({ type: "success", text: "Template saved!" });
      fetchTemplates();
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save template",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAs() {
    const newName = prompt(
      "Enter a name for the duplicate template:",
      `${templateName} (Copy)`
    );
    if (!newName || !newName.trim()) return;

    const prevId = templateId;
    const prevName = templateName;
    setTemplateId(null);
    setTemplateName(newName.trim());

    try {
      await handleSave();
    } catch {
      // Restore on failure
      setTemplateId(prevId);
      setTemplateName(prevName);
    }
  }

  async function handleTogglePublish() {
    if (!templateId) {
      setSaveMessage({
        type: "error",
        text: "Save the template first before publishing",
      });
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isPublished }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update status");
      }

      setIsPublished(!isPublished);
      setSaveMessage({
        type: "success",
        text: isPublished
          ? "Template unpublished"
          : "Template published and active!",
      });
      fetchTemplates();
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to toggle publish",
      });
    } finally {
      setPublishing(false);
    }
  }

  /* ================================================================== */
  /*  Step extraction (backward compat)                                  */
  /* ================================================================== */

  function extractStepsFromFlow(flowNodes: Node[], flowEdges: Edge[]) {
    const steps: {
      index: number;
      name: string;
      type: string;
      description?: string;
    }[] = [];

    const adj: Record<string, string[]> = {};
    for (const e of flowEdges) {
      if (!adj[e.source]) adj[e.source] = [];
      adj[e.source].push(e.target);
    }

    const startNodes = flowNodes.filter((n) => n.type === "start");
    if (startNodes.length === 0) return steps;

    const visited = new Set<string>();
    const queue = [...startNodes.map((n) => n.id)];
    let stepIndex = 0;

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentNode = flowNodes.find((n) => n.id === currentId);
      if (!currentNode) continue;

      if (currentNode.type === "task") {
        steps.push({
          index: stepIndex++,
          name: currentNode.data.label || "Untitled",
          type: currentNode.data.taskType || "approval",
          description: currentNode.data.description || undefined,
        });
      }

      const children = adj[currentId] ?? [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }

    return steps;
  }

  function getPreviewSteps() {
    return extractStepsFromFlow(nodes, edges);
  }

  /* ================================================================== */
  /*  Stats                                                              */
  /* ================================================================== */

  const nodeStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      counts[n.type ?? "unknown"] = (counts[n.type ?? "unknown"] ?? 0) + 1;
    }
    return counts;
  }, [nodes]);

  /* ================================================================== */
  /*  Permission gate                                                    */
  /* ================================================================== */

  if (!hasPermission) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to access the workflow designer.
          </p>
        </div>
      </div>
    );
  }

  /* ================================================================== */
  /*  Render                                                             */
  /* ================================================================== */

  const errorCount = validationIssues.filter(
    (i) => i.severity === "error"
  ).length;
  const warnCount = validationIssues.filter(
    (i) => i.severity === "warning"
  ).length;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* ============================================================ */}
      {/*  TOOLBAR ROW 1 - Template info + primary actions              */}
      {/* ============================================================ */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="px-4 py-2 flex flex-wrap items-center gap-2">
          {/* Template name (inline editable) */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="relative flex items-center">
              {hasUnsavedChanges && (
                <span
                  className="absolute -left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                  title="Unsaved changes"
                />
              )}
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Untitled Workflow..."
                className="h-9 w-48 lg:w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-sm font-bold text-gray-900 dark:text-gray-100 placeholder:text-gray-400 placeholder:font-normal transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
              />
            </div>
            <input
              type="text"
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              placeholder="Description..."
              className="h-9 w-48 lg:w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-sm text-gray-600 dark:text-gray-400 placeholder:text-gray-400 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none hidden md:block"
            />
            {/* Version badge */}
            {templateId && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
                v{templateVersion}
              </span>
            )}
          </div>

          {/* Action group */}
          <div className="flex items-center gap-1.5">
            {/* Undo */}
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
                />
              </svg>
            </button>

            {/* Redo */}
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Shift+Z)"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3"
                />
              </svg>
            </button>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* Auto-layout */}
            <button
              onClick={() => {
                if (nodes.length > 0 && confirm("This will rearrange all nodes. Your current layout will be lost. Continue?")) {
                  handleAutoLayout();
                }
              }}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Auto-arrange nodes (will override current positions)"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
                />
              </svg>
              <span className="hidden lg:inline">Layout</span>
            </button>

            {/* Validate */}
            <button
              onClick={handleValidate}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Validate workflow"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <span className="hidden lg:inline">Validate</span>
              {validationIssues.length > 0 && (
                <span
                  className={`ml-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold inline-flex items-center justify-center ${
                    errorCount > 0
                      ? "bg-red-500 text-white"
                      : "bg-amber-500 text-white"
                  }`}
                >
                  {validationIssues.length}
                </span>
              )}
            </button>

            {/* Download as Image */}
            <button
              onClick={handleDownloadImage}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Download workflow as PNG image"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              <span className="hidden lg:inline">Export</span>
            </button>

            {/* Preview/Simulate */}
            <button
              onClick={() => setShowPreview(true)}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Preview workflow"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
              <span className="hidden lg:inline">Preview</span>
            </button>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* Load template dropdown */}
            <div className="relative" ref={loadDropdownRef}>
              <button
                onClick={() => {
                  setShowLoadDropdown(!showLoadDropdown);
                  if (!showLoadDropdown) fetchTemplates();
                }}
                className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
                title="Load template"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
                  />
                </svg>
                <span className="hidden lg:inline">Load</span>
                <svg
                  className={`w-3 h-3 transition-transform ${showLoadDropdown ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m19.5 8.25-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </button>

              {showLoadDropdown && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2">
                      Templates
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {loadingTemplates ? (
                      <div className="p-4 text-center">
                        <svg
                          className="animate-spin h-5 w-5 text-gray-400 mx-auto"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      </div>
                    ) : templates.length === 0 ? (
                      <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">
                        No saved templates
                      </div>
                    ) : (
                      templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => handleLoadTemplate(t.id)}
                          className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0 ${
                            templateId === t.id
                              ? "bg-[#02773b]/5 dark:bg-[#02773b]/10"
                              : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {t.name}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
                              v{t.version ?? 1}
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                              {t.description}
                            </p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-gray-100 dark:border-gray-800">
                    <button
                      onClick={handleClear}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors"
                    >
                      Clear canvas (new)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* Publish/Unpublish toggle */}
            <button
              onClick={handleTogglePublish}
              disabled={!templateId || publishing}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                isPublished
                  ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-950/50"
                  : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-950/50"
              }`}
              title={isPublished ? "Unpublish template" : "Publish template"}
            >
              {publishing ? (
                <svg
                  className="animate-spin h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : isPublished ? (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
                  />
                </svg>
              )}
              <span className="hidden sm:inline">
                {isPublished ? "Unpublish" : "Publish"}
              </span>
            </button>

            {/* Save As */}
            <button
              onClick={handleSaveAs}
              disabled={saving}
              className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              title="Save as new template"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.5a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"
                />
              </svg>
              <span className="hidden lg:inline">Save As</span>
            </button>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-8 px-4 rounded-lg bg-[#02773b] text-white text-xs font-semibold hover:bg-[#026332] transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
            >
              {saving ? (
                <svg
                  className="animate-spin h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
              )}
              Save
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="px-4 pb-2 flex items-center gap-3 text-[11px]">
          {/* Node count chips */}
          <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
            <span>
              {nodes.length} node{nodes.length !== 1 ? "s" : ""}
            </span>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <span>
              {edges.length} edge{edges.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Published status */}
          {templateId && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                isPublished
                  ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isPublished ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {isPublished ? "Published" : "Draft"}
            </span>
          )}

          {/* Unsaved indicator */}
          {hasUnsavedChanges && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Unsaved changes
            </span>
          )}

          {/* Save message */}
          {saveMessage && (
            <span
              className={`font-medium ${
                saveMessage.type === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {saveMessage.text}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Quick stats */}
          <div className="hidden md:flex items-center gap-2 text-gray-400 dark:text-gray-500">
            {nodeStats.task && (
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm bg-[#02773b]" />
                {nodeStats.task} task{nodeStats.task !== 1 ? "s" : ""}
              </span>
            )}
            {nodeStats.decision && (
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-sm bg-yellow-500" />
                {nodeStats.decision} decision
                {nodeStats.decision !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  MAIN CONTENT - 3-panel layout                                */}
      {/* ============================================================ */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop — closes open panels when tapped */}
        {(leftPanelOpen || rightPanelOpen) && (
          <div
            className="lg:hidden absolute inset-0 bg-black/40 z-10"
            onClick={() => { setLeftPanelOpen(false); setRightPanelOpen(false); }}
          />
        )}

        {/* ---- Left Panel: Node Palette ---- */}
        <div
          className={`
            absolute inset-y-0 left-0 z-20
            lg:relative lg:inset-auto lg:z-auto lg:flex-shrink-0
            bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
            transition-all duration-300 overflow-hidden
            ${leftPanelOpen ? "w-56 shadow-xl lg:shadow-none" : "w-0"}
          `}
        >
          <div className="w-56 h-full overflow-y-auto p-4">
            <NodePalette />
          </div>
        </div>

        {/* Left panel toggle */}
        <button
          onClick={() => { setLeftPanelOpen(!leftPanelOpen); if (!leftPanelOpen) setRightPanelOpen(false); }}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 lg:relative lg:top-auto lg:left-auto lg:translate-y-0 lg:z-auto flex-shrink-0 w-6 lg:w-5 h-12 lg:h-full bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors rounded-r-lg lg:rounded-none shadow-sm lg:shadow-none"
          title={leftPanelOpen ? "Hide palette" : "Show palette"}
          style={leftPanelOpen ? { left: "224px" } : undefined}
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform ${leftPanelOpen ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* ---- Center: Canvas ---- */}
        <div className="flex-1 min-w-0 relative">
          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodeSelect={handleNodeSelect}
          />

          {/* Validation panel overlay (bottom of canvas) */}
          {showValidationPanel && validationIssues.length > 0 && (
            <div className="absolute bottom-4 left-4 right-4 max-h-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-10 animate-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Validation Results
                  </h4>
                  {errorCount > 0 && (
                    <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                      {errorCount} error{errorCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                      {warnCount} warning{warnCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowValidationPanel(false);
                    clearValidationHighlights();
                    setValidationIssues([]);
                  }}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto max-h-32 divide-y divide-gray-100 dark:divide-gray-800">
                {validationIssues.map((issue, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-default"
                  >
                    {issue.severity === "error" ? (
                      <svg
                        className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                        />
                      </svg>
                    )}
                    <span
                      className={
                        issue.severity === "error"
                          ? "text-red-700 dark:text-red-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {issue.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel toggle */}
        <button
          onClick={() => { setRightPanelOpen(!rightPanelOpen); if (!rightPanelOpen) setLeftPanelOpen(false); }}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-30 lg:relative lg:top-auto lg:right-auto lg:translate-y-0 lg:z-auto flex-shrink-0 w-6 lg:w-5 h-12 lg:h-full bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors rounded-l-lg lg:rounded-none shadow-sm lg:shadow-none"
          title={rightPanelOpen ? "Hide config" : "Show config"}
          style={rightPanelOpen ? { right: "288px" } : undefined}
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform ${rightPanelOpen ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* ---- Right Panel: Node Configuration ---- */}
        <div
          className={`
            absolute inset-y-0 right-0 z-20
            lg:relative lg:inset-auto lg:z-auto lg:flex-shrink-0
            bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800
            transition-all duration-300 overflow-hidden
            ${rightPanelOpen ? "w-72 shadow-xl lg:shadow-none" : "w-0"}
          `}
        >
          <div className="w-72 h-full overflow-y-auto">
            <div className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                Node Configuration
              </h3>
              {selectedNode ? (
                <NodeConfigPanel
                  node={selectedNode}
                  onUpdate={handleUpdateNodeData}
                  onDelete={handleDeleteNode}
                />
              ) : (
                <div className="text-center py-8">
                  <svg
                    className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59"
                    />
                  </svg>
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    Select a node to configure
                  </p>
                  <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-1">
                    Click any node on the canvas
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  PREVIEW / SIMULATE MODAL                                     */}
      {/* ============================================================ */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowPreview(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[80vh] overflow-y-auto animate-scale-in">
            {/* Header */}
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#02773b]/10 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-[#02773b]"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Workflow Preview
                </h2>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Template info */}
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {templateName || "Untitled Template"}
                </h3>
                {templateDescription && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {templateDescription}
                  </p>
                )}
              </div>

              {/* Statistics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {nodes.length}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
                    Nodes
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {edges.length}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
                    Connections
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    v{templateVersion}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
                    Version
                  </p>
                </div>
              </div>

              {/* Node breakdown */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Node Breakdown
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(nodeStats).map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300"
                    >
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{
                          backgroundColor:
                            type === "start"
                              ? "#22c55e"
                              : type === "end"
                                ? "#ef4444"
                                : type === "decision"
                                  ? "#eab308"
                                  : type === "task"
                                    ? "#02773b"
                                    : type === "timer"
                                      ? "#64748b"
                                      : type === "email"
                                        ? "#a855f7"
                                        : type === "subprocess"
                                          ? "#14b8a6"
                                          : type === "parallel"
                                            ? "#3b82f6"
                                            : "#6b7280",
                        }}
                      />
                      {count} {type}
                    </span>
                  ))}
                </div>
              </div>

              {/* Task step sequence */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Task Sequence
                </p>
                {(() => {
                  const steps = getPreviewSteps();
                  if (steps.length === 0) {
                    return (
                      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                        No task nodes found. Add task nodes and connect them
                        from Start to End.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-0">
                      {steps.map((step, idx) => (
                        <div key={idx} className="flex items-stretch gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-[#02773b]">
                                {idx + 1}
                              </span>
                            </div>
                            {idx < steps.length - 1 && (
                              <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 my-1" />
                            )}
                          </div>
                          <div className="pb-4 flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {step.name}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                                  step.type === "approval"
                                    ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                                    : step.type === "review"
                                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                                      : "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400"
                                }`}
                              >
                                {step.type}
                              </span>
                              {step.description && (
                                <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                                  {step.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Validation quick check */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Quick Validation
                </p>
                {(() => {
                  const issues = validateWorkflow();
                  if (issues.length === 0) {
                    return (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                        <svg
                          className="w-4 h-4 text-green-600 dark:text-green-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                          />
                        </svg>
                        <span className="text-sm font-medium text-green-700 dark:text-green-400">
                          Workflow is valid
                        </span>
                      </div>
                    );
                  }
                  const errs = issues.filter((i) => i.severity === "error");
                  const warns = issues.filter((i) => i.severity === "warning");
                  return (
                    <div className="space-y-1.5">
                      {errs.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                          <svg
                            className="w-4 h-4 text-red-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                            />
                          </svg>
                          <span className="text-xs font-medium text-red-700 dark:text-red-400">
                            {errs.length} error{errs.length !== 1 ? "s" : ""}{" "}
                            found
                          </span>
                        </div>
                      )}
                      {warns.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <svg
                            className="w-4 h-4 text-amber-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                            />
                          </svg>
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                            {warns.length} warning{warns.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
