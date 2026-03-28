"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useNodesState, useEdgesState, MarkerType, type Node, type Edge } from "reactflow";
import NodePalette from "@/components/workflow/node-palette";
import NodeConfigPanel from "@/components/workflow/node-config-panel";

const WorkflowCanvas = dynamic(() => import("@/components/workflow/canvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <svg className="animate-spin h-8 w-8 text-karu-green mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading workflow designer...</p>
      </div>
    </div>
  ),
});

interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  definition: {
    nodes?: Node[];
    edges?: Edge[];
    steps?: { index: number; name: string; type: string }[];
  };
}

const defaultNodes: Node[] = [
  {
    id: "start_1",
    type: "start",
    position: { x: 250, y: 50 },
    data: {},
  },
];

const defaultEdges: Edge[] = [];

export default function WorkflowDesignerPage() {
  const { data: session } = useSession();

  // Canvas state
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Template state
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const hasPermission = session?.user?.permissions?.includes("workflows:manage");

  // Load templates list
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

  // Update node data
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

  // Delete node
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

  // Node selection
  const handleNodeSelect = useCallback(
    (node: Node | null) => {
      setSelectedNode(node);
      if (node && !rightPanelOpen) {
        setRightPanelOpen(true);
      }
    },
    [rightPanelOpen]
  );

  // Clear canvas
  function handleClear() {
    if (!confirm("Clear the canvas? This will remove all nodes and connections.")) return;
    setNodes(defaultNodes);
    setEdges(defaultEdges);
    setSelectedNode(null);
    setTemplateId(null);
    setTemplateName("");
    setTemplateDescription("");
  }

  // Load template
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

      const def = tmpl.definition;

      // If the definition has nodes/edges (designer format), load them directly
      if (def.nodes && Array.isArray(def.nodes)) {
        setNodes(def.nodes);
        setEdges(def.edges ?? []);
      } else if (def.steps && Array.isArray(def.steps)) {
        // Legacy step-based format: convert to nodes/edges
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

        def.steps.forEach((step: { name: string; type: string; description?: string }, idx: number) => {
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
            markerEnd: { type: MarkerType.ArrowClosed, color: "#02773b", width: 20, height: 20 },
            style: { stroke: "#02773b", strokeWidth: 2 },
          });
          prevNodeId = nodeId;
        });

        // Add end node
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
          markerEnd: { type: MarkerType.ArrowClosed, color: "#02773b", width: 20, height: 20 },
          style: { stroke: "#02773b", strokeWidth: 2 },
        });

        setNodes(convertedNodes);
        setEdges(convertedEdges);
      }

      setSelectedNode(null);
    } catch {
      setSaveMessage({ type: "error", text: "Failed to load template" });
    }
  }

  // Save template
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
      })),
      // Also produce legacy steps array for backward compatibility
      steps: extractStepsFromFlow(nodes, edges),
    };

    try {
      let res;
      if (templateId) {
        // Update existing
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
        // Create new
        res = await fetch("/api/workflows/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            description: templateDescription.trim() || undefined,
            steps: definition.steps.length > 0
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

      setSaveMessage({ type: "success", text: "Template saved successfully!" });
      fetchTemplates();

      // Clear success message after 3s
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

  // Extract linear steps from the flow graph for backward compatibility
  function extractStepsFromFlow(flowNodes: Node[], flowEdges: Edge[]) {
    const steps: { index: number; name: string; type: string; description?: string }[] = [];

    // Build adjacency map
    const adj: Record<string, string[]> = {};
    for (const e of flowEdges) {
      if (!adj[e.source]) adj[e.source] = [];
      adj[e.source].push(e.target);
    }

    // BFS from start nodes
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

  // Generate preview text
  function getPreviewSteps() {
    return extractStepsFromFlow(nodes, edges);
  }

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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Template name */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name..."
              className="h-9 w-full max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
            <input
              type="text"
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              placeholder="Description (optional)..."
              className="h-9 w-full max-w-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none hidden lg:block"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Load Template */}
            <select
              value=""
              onChange={(e) => handleLoadTemplate(e.target.value)}
              disabled={loadingTemplates}
              className="h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-700 dark:text-gray-300 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            >
              <option value="">Load Template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {/* Clear */}
            <button
              onClick={handleClear}
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Clear canvas"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              <span className="hidden sm:inline">Clear</span>
            </button>

            {/* Preview */}
            <button
              onClick={() => setShowPreview(true)}
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              title="Preview workflow"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <span className="hidden sm:inline">Preview</span>
            </button>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {saving ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              )}
              <span className="hidden sm:inline">Save Template</span>
              <span className="sm:hidden">Save</span>
            </button>
          </div>
        </div>

        {/* Save message */}
        {saveMessage && (
          <div
            className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              saveMessage.type === "success"
                ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
            }`}
          >
            {saveMessage.text}
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Node Palette */}
        <div
          className={`flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-300 overflow-hidden ${
            leftPanelOpen ? "w-56" : "w-0"
          }`}
        >
          <div className="w-56 h-full overflow-y-auto p-4">
            <NodePalette />
          </div>
        </div>

        {/* Left Panel Toggle */}
        <button
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          className="flex-shrink-0 w-5 bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          title={leftPanelOpen ? "Hide palette" : "Show palette"}
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

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <WorkflowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodeSelect={handleNodeSelect}
          />
        </div>

        {/* Right Panel Toggle */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className="flex-shrink-0 w-5 bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          title={rightPanelOpen ? "Hide config" : "Show config"}
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

        {/* Right Panel - Node Configuration */}
        <div
          className={`flex-shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 transition-all duration-300 overflow-hidden ${
            rightPanelOpen ? "w-72" : "w-0"
          }`}
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
                    Click a node on the canvas to configure it
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowPreview(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[80vh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Workflow Preview
              </h2>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {templateName || "Untitled Template"}
                </h3>
                {templateDescription && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {templateDescription}
                  </p>
                )}
              </div>

              <div className="space-y-1 mb-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Summary
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {nodes.length} node{nodes.length !== 1 ? "s" : ""}, {edges.length} connection{edges.length !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Task Steps (in order)
                </p>
                {(() => {
                  const steps = getPreviewSteps();
                  if (steps.length === 0) {
                    return (
                      <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                        No task nodes found. Add task nodes and connect them from Start to End.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {steps.map((step, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-7 h-7 rounded-full bg-karu-green/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-karu-green">
                                {idx + 1}
                              </span>
                            </div>
                            {idx < steps.length - 1 && (
                              <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mt-1" />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {step.name}
                            </span>
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
                          </div>
                        </div>
                      ))}
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
