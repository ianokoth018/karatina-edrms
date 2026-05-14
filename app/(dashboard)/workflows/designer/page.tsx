"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import {
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from "reactflow";
import NodePalette from "@/components/workflow/node-palette";
import NodeConfigPanel from "@/components/workflow/node-config-panel";
import VariablesPanel from "@/components/workflow/variables-panel";
import TriggersDialog from "@/components/workflow/triggers-dialog";
import SimulatorDialog from "@/components/workflow/simulator-dialog";
import VersionHistoryDialog from "@/components/workflow/version-history-dialog";
import {
  validateWorkflow as runWorkflowValidation,
  hasBlockingIssues,
  type Issue as ValidationLibIssue,
} from "@/lib/workflow-validation";
import { autoLayoutNodes } from "@/lib/workflow-layout";

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
  slug?: string | null;
  instanceName?: string | null;
  sidebarIcon?: string | null;
  sidebarOrder?: number;
  customQueries?: CustomView[];
  definition: {
    nodes?: Node[];
    edges?: Edge[];
    steps?: { index: number; name: string; type: string }[];
  };
}

const SIDEBAR_ICONS = [
  { name: "document", label: "Document" },
  { name: "users", label: "People" },
  { name: "briefcase", label: "Briefcase" },
  { name: "academic-cap", label: "Academic" },
  { name: "building", label: "Building" },
  { name: "clipboard", label: "Clipboard" },
  { name: "chart-bar", label: "Chart" },
  { name: "arrow-path", label: "Process" },
  { name: "envelope", label: "Mail" },
  { name: "shield", label: "Shield" },
] as const;

type SidebarIconName = (typeof SIDEBAR_ICONS)[number]["name"];

interface CustomView {
  id: string;
  label: string;
  description?: string;
  filter: string;
}

const FILTER_OPTIONS = [
  // Scope
  { group: "Scope", value: "all",            label: "All instances" },
  { group: "Scope", value: "mine",           label: "Started by me" },
  { group: "Scope", value: "assigned_to_me", label: "Assigned to me (pending tasks)" },
  // Status
  { group: "Status", value: "status:IN_PROGRESS", label: "In progress" },
  { group: "Status", value: "status:COMPLETED",   label: "Completed" },
  { group: "Status", value: "status:REJECTED",    label: "Rejected" },
  { group: "Status", value: "status:CANCELLED",   label: "Cancelled" },
  // Timing
  { group: "Timing", value: "overdue",       label: "Overdue (past due date)" },
  { group: "Timing", value: "mine_pending",  label: "My pending instances" },
  // Step (dynamic — appended at render time)
  { group: "Step",   value: "step:",         label: "At specific step…" },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type ValidationIssue = ValidationLibIssue;

interface NodeRuntimeStats {
  total: number;
  completed: number;
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  breaches: number;
  avgDwellMs: number;
}

interface RuntimeStatsResponse {
  totalInstances: number;
  completedInstances: number;
  windowDays: number | null;
  byNode: Record<string, NodeRuntimeStats>;
  byStepName: Record<string, NodeRuntimeStats>;
}

/** Strip the transient `__runtime` overlay before persisting a node. */
function persistableNodeData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const { __runtime: _drop, ...rest } = data as Record<string, unknown>;
  void _drop;
  return rest;
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
/*  Icon renderer for sidebar icon picker                              */
/* ------------------------------------------------------------------ */

function WorkflowIcon({ name, className }: { name: string; className?: string }) {
  const cls = className ?? "w-5 h-5";
  switch (name) {
    case "users":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>;
    case "briefcase":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" /></svg>;
    case "academic-cap":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 3.741-3.342M12 3.493V2.25m0 5.25a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0Z" /></svg>;
    case "building":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>;
    case "clipboard":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>;
    case "chart-bar":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>;
    case "arrow-path":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>;
    case "envelope":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>;
    case "shield":
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>;
    default: // document
      return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>;
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function WorkflowDesignerPage() {
  const { data: session } = useSession();

  // ---- Canvas state ----
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  // Runtime overlay: when on, fetch per-node stats and inject into node.data.__runtime
  const [runtimeOverlay, setRuntimeOverlay] = useState(false);
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStatsResponse | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  // Version history dialog
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // ---- Template state ----
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [showTriggers, setShowTriggers] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [templateVersion, setTemplateVersion] = useState<number>(1);
  const [isPublished, setIsPublished] = useState(false);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // ---- Module settings ----
  const [moduleSlug, setModuleSlug] = useState("");
  const [moduleInstanceName, setModuleInstanceName] = useState("");
  const [moduleSidebarIcon, setModuleSidebarIcon] = useState<SidebarIconName>("document");
  const [moduleSidebarOrder, setModuleSidebarOrder] = useState(0);
  const [moduleCustomViews, setModuleCustomViews] = useState<CustomView[]>([]);
  const [showModuleSettings, setShowModuleSettings] = useState(false);
  const [newViewLabel, setNewViewLabel] = useState("");
  const [newViewFilter, setNewViewFilter] = useState("all");
  const [newViewStep, setNewViewStep] = useState("");
  const [newViewDesc, setNewViewDesc] = useState("");

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

  // ---- Auto-save state ----
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string; key: string } | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverAutosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Open panels by default on desktop, closed on mobile
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setLeftPanelOpen(true);
      setRightPanelOpen(true);
    }
  }, []);

  // Check for a saved draft when opening a new template
  useEffect(() => {
    if (urlTemplateId) return; // existing templates are checked inside handleLoadTemplate
    try {
      const raw = localStorage.getItem("wf-draft-new");
      if (!raw) return;
      const draft = JSON.parse(raw) as { savedAt?: string };
      if (draft.savedAt) setDraftBanner({ savedAt: draft.savedAt, key: "wf-draft-new" });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Undo/Redo history ----
  const historyRef = useRef<HistoryEntry[]>([
    { nodes: defaultNodes, edges: defaultEdges },
  ]);
  const historyIndexRef = useRef(0);
  const isUndoRedoRef = useRef(false);

  const hasPermission = session?.user?.permissions?.includes("workflows:manage");

  /* ================================================================== */
  /*  Runtime overlay                                                    */
  /*                                                                    */
  /*  When toggled on, fetch per-node aggregate stats for this template  */
  /*  and surface them on each node card via data.__runtime. Cleared on  */
  /*  toggle-off so node cards return to design-time view.               */
  /* ================================================================== */
  useEffect(() => {
    if (!runtimeOverlay) {
      setRuntimeStats(null);
      return;
    }
    if (!templateId) return;
    let cancelled = false;
    setRuntimeLoading(true);
    fetch(`/api/workflows/templates/${templateId}/runtime-stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: RuntimeStatsResponse) => {
        if (!cancelled) setRuntimeStats(data);
      })
      .catch(() => {
        if (!cancelled) setRuntimeStats(null);
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeOverlay, templateId]);

  // Project stats onto nodes by injecting/clearing data.__runtime.
  // We only mutate nodes when the projected payload actually changes,
  // otherwise React Flow re-renders the canvas on every keystroke.
  useEffect(() => {
    setNodes((nds: Node[]) =>
      nds.map((n) => {
        const existing = (n.data as { __runtime?: NodeRuntimeStats })?.__runtime;
        let next: NodeRuntimeStats | undefined;
        if (runtimeStats) {
          next =
            runtimeStats.byNode[n.id] ??
            runtimeStats.byStepName[(n.data?.label as string) ?? ""];
        }
        if (existing === next) return n;
        if (!existing && !next) return n;
        const { __runtime: _drop, ...rest } = (n.data ?? {}) as Record<string, unknown>;
        void _drop;
        return {
          ...n,
          data: next ? { ...rest, __runtime: next } : rest,
        };
      })
    );
  }, [runtimeStats, setNodes]);

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
        data: persistableNodeData(n.data),
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

  // Server-side auto-save for existing templates (1.5 s debounce after last change)
  useEffect(() => {
    if (!hasUnsavedChanges || !templateId || !templateName.trim()) return;
    if (serverAutosaveRef.current) clearTimeout(serverAutosaveRef.current);
    serverAutosaveRef.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const definition = {
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: persistableNodeData(n.data) })),
          edges: edges.map((e) => ({
            id: e.id, source: e.source, target: e.target,
            sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
            type: e.type, animated: e.animated, markerEnd: e.markerEnd,
            style: e.style, label: e.label, data: e.data,
          })),
          steps: extractStepsFromFlow(nodes, edges),
        };
        const res = await fetch(`/api/workflows/templates/${templateId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            description: templateDescription.trim() || undefined,
            definition,
            slug: moduleSlug.trim() || null,
            instanceName: moduleInstanceName.trim() || null,
            sidebarIcon: moduleSidebarIcon || "document",
            sidebarOrder: moduleSidebarOrder,
            customQueries: moduleCustomViews,
          }),
        });
        if (res.ok) {
          const result = await res.json();
          if (result.template?.version) setTemplateVersion(result.template.version);
          savedSnapshotRef.current = currentSnapshot;
          setLastSavedAt(new Date());
          try { localStorage.removeItem(`wf-draft-${templateId}`); } catch {}
          setDraftBanner(null);
        }
      } catch { /* silent — user still has unsaved indicator */ }
      setAutoSaving(false);
    }, 1500);
    return () => {
      if (serverAutosaveRef.current) clearTimeout(serverAutosaveRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges, templateId, templateName, templateDescription, nodes, edges,
      moduleSlug, moduleInstanceName, moduleSidebarIcon, moduleSidebarOrder, moduleCustomViews]);

  // localStorage draft only for brand-new (unsaved) templates
  useEffect(() => {
    if (!hasUnsavedChanges || templateId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem("wf-draft-new", JSON.stringify({
          templateName, templateDescription, nodes, edges,
          moduleSlug, moduleInstanceName, moduleSidebarIcon, moduleSidebarOrder, moduleCustomViews,
          savedAt: new Date().toISOString(),
        }));
      } catch {}
    }, 500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  // currentSnapshot as a lightweight change signal; individual states captured by closure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, hasUnsavedChanges]);

  // Save immediately to localStorage before the page unloads
  useEffect(() => {
    function handleBeforeUnload() {
      if (!hasUnsavedChanges) return;
      try {
        const key = `wf-draft-${templateId ?? "new"}`;
        localStorage.setItem(key, JSON.stringify({
          templateId,
          templateName,
          templateDescription,
          nodes,
          edges,
          moduleSlug,
          moduleInstanceName,
          moduleSidebarIcon,
          moduleSidebarOrder,
          moduleCustomViews,
          savedAt: new Date().toISOString(),
        }));
      } catch {}
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges, templateId, templateName, templateDescription, nodes, edges,
      moduleSlug, moduleInstanceName, moduleSidebarIcon, moduleSidebarOrder, moduleCustomViews]);

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
      const res = await fetch("/api/workflows/templates?all=true");
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

  // Auto-load template from URL ?template=id
  const searchParams = useSearchParams();
  const urlTemplateId = searchParams.get("template");
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (urlTemplateId && !didAutoLoad.current) {
      didAutoLoad.current = true;
      handleLoadTemplate(urlTemplateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTemplateId]);

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

  function restoreLocalDraft(key: string) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.templateName !== undefined) setTemplateName(draft.templateName);
      if (draft.templateDescription !== undefined) setTemplateDescription(draft.templateDescription);
      if (Array.isArray(draft.nodes)) setNodes(draft.nodes);
      if (Array.isArray(draft.edges)) setEdges(draft.edges);
      if (draft.moduleSlug !== undefined) setModuleSlug(draft.moduleSlug);
      if (draft.moduleInstanceName !== undefined) setModuleInstanceName(draft.moduleInstanceName);
      if (draft.moduleSidebarIcon) setModuleSidebarIcon(draft.moduleSidebarIcon);
      if (draft.moduleSidebarOrder !== undefined) setModuleSidebarOrder(draft.moduleSidebarOrder);
      if (Array.isArray(draft.moduleCustomViews)) setModuleCustomViews(draft.moduleCustomViews);
      if (draft.templateId) setTemplateId(draft.templateId);
    } catch {}
    setDraftBanner(null);
  }

  function discardLocalDraft(key: string) {
    try { localStorage.removeItem(key); } catch {}
    setDraftBanner(null);
  }

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
    setModuleSlug("");
    setModuleInstanceName("");
    setModuleSidebarIcon("document");
    setModuleSidebarOrder(0);
    setModuleCustomViews([]);
    setValidationIssues([]);
    setHighlightedNodes(new Set());
    setShowValidationPanel(false);
    savedSnapshotRef.current = "";
    historyRef.current = [{ nodes: defaultNodes, edges: defaultEdges }];
    historyIndexRef.current = 0;
  }

  // Auto-layout: arrange nodes in a top-down tree layout
  function handleAutoLayout() {
    setNodes((nds: Node[]) =>
      autoLayoutNodes(nds, edges, { originX: 400, originY: 60 })
    );
  }

  /* ================================================================== */
  /*  Validation                                                         */
  /* ================================================================== */

  function validateWorkflow(): ValidationIssue[] {
    return runWorkflowValidation(nodes, edges);
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
      setModuleSlug(tmpl.slug ?? "");
      setModuleInstanceName(tmpl.instanceName ?? "");
      setModuleSidebarIcon((tmpl.sidebarIcon as SidebarIconName) ?? "document");
      setModuleSidebarOrder(tmpl.sidebarOrder ?? 0);
      setModuleCustomViews(Array.isArray(tmpl.customQueries) ? tmpl.customQueries as CustomView[] : []);

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

      // Check for a local draft newer than the server copy
      try {
        const raw = localStorage.getItem(`wf-draft-${tmpl.id}`);
        if (raw) {
          const draft = JSON.parse(raw) as { savedAt?: string };
          if (draft.savedAt) setDraftBanner({ savedAt: draft.savedAt, key: `wf-draft-${tmpl.id}` });
        }
      } catch {}

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
        data: persistableNodeData(n.data),
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

    const modulePayload = {
      slug: moduleSlug.trim() || null,
      instanceName: moduleInstanceName.trim() || null,
      sidebarIcon: moduleSidebarIcon || "document",
      sidebarOrder: moduleSidebarOrder,
      customQueries: moduleCustomViews,
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
            ...modulePayload,
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
            ...modulePayload,
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

      // Clear local draft after successful server save
      try { localStorage.removeItem(`wf-draft-${templateId ?? "new"}`); } catch {}
      setDraftBanner(null);

      savedSnapshotRef.current = currentSnapshot;
      setLastSavedAt(new Date());
      setSaveMessage({ type: "success", text: "Saved" });
      fetchTemplates();
      setTimeout(() => setSaveMessage(null), 2000);
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

    // Only gate the publish direction — unpublishing always allowed so admins
    // can pull a misbehaving template offline even if validation regressed.
    if (!isPublished) {
      const issues = runWorkflowValidation(nodes, edges);
      if (hasBlockingIssues(issues)) {
        setValidationIssues(issues);
        setShowValidationPanel(true);
        const problemNodeIds = new Set(
          issues.filter((i) => i.nodeId).map((i) => i.nodeId!)
        );
        setHighlightedNodes(problemNodeIds);
        setNodes((nds: Node[]) =>
          nds.map((n) => ({
            ...n,
            className: problemNodeIds.has(n.id)
              ? "!ring-2 !ring-red-500 !ring-offset-2 rounded-xl"
              : "",
          }))
        );
        const errCount = issues.filter((i) => i.severity === "error").length;
        setSaveMessage({
          type: "error",
          text: `Fix ${errCount} validation error${errCount === 1 ? "" : "s"} before publishing.`,
        });
        return;
      }
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
      window.dispatchEvent(new Event("workflowSidebarRefresh"));
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
      {/* Draft restore banner */}
      {draftBanner && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-sm">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-amber-800 dark:text-amber-300 flex-1">
            You have unsaved local changes from {new Date(draftBanner.savedAt).toLocaleString()}. Restore them?
          </span>
          <button
            onClick={() => restoreLocalDraft(draftBanner.key)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Restore
          </button>
          <button
            onClick={() => discardLocalDraft(draftBanner.key)}
            className="px-3 py-1 text-xs font-semibold rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          >
            Discard
          </button>
        </div>
      )}
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

            {/* Snap-to-grid toggle */}
            <button
              onClick={() => setSnapToGrid((v) => !v)}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                snapToGrid
                  ? "bg-karu-green/10 text-[#02773b] dark:text-[#60c988]"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title={snapToGrid ? "Snap-to-grid: ON" : "Snap-to-grid: OFF"}
              aria-pressed={snapToGrid}
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
                  d="M3.75 3v18M9 3v18M14.25 3v18M19.5 3v18M3 3.75h18M3 9h18M3 14.25h18M3 19.5h18"
                />
              </svg>
              <span className="hidden lg:inline">Snap</span>
            </button>

            {/* Runtime overlay toggle */}
            <button
              onClick={() => setRuntimeOverlay((v) => !v)}
              disabled={!templateId}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                runtimeOverlay
                  ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title={
                !templateId
                  ? "Save the template first to view runtime stats"
                  : runtimeOverlay
                  ? "Hide runtime stats"
                  : "Overlay per-node dwell time, rejection rate, and SLA breaches"
              }
              aria-pressed={runtimeOverlay}
            >
              {runtimeLoading ? (
                <svg
                  className="animate-spin w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                  />
                </svg>
              )}
              <span className="hidden lg:inline">Runtime</span>
            </button>

            {/* Version history */}
            <button
              onClick={() => setShowVersionHistory(true)}
              disabled={!templateId}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={templateId ? "Compare and restore previous published versions" : "Save the template first to view version history"}
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
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 12h2.25M18.75 12H21M5.636 5.636l1.591 1.591M16.773 16.773l1.591 1.591"
                />
              </svg>
              <span className="hidden lg:inline">History</span>
            </button>

            {/* Triggers */}
            <button
              onClick={() => setShowTriggers(true)}
              disabled={!templateId}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={templateId ? "Manage triggers" : "Save the template first"}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="hidden lg:inline">Triggers</span>
            </button>

            {/* Simulate / Test */}
            <button
              onClick={() => setShowSimulator(true)}
              disabled={nodes.length === 0}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Dry-run with sample data"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              <span className="hidden lg:inline">Test</span>
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
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {!t.isActive && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                                  Draft
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-gray-400">
                                v{t.version ?? 1}
                              </span>
                            </div>
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

          {/* Auto-save status */}
          {autoSaving ? (
            <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Saving…
            </span>
          ) : lastSavedAt && !hasUnsavedChanges ? (
            <span className="text-green-600 dark:text-green-400 font-medium">
              Saved {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : hasUnsavedChanges && !templateId ? (
            <span className="text-amber-600 dark:text-amber-400 font-medium">Unsaved</span>
          ) : null}

          {/* Save message (manual saves / errors) */}
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
            snapToGrid={snapToGrid}
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
                  <button
                    type="button"
                    key={idx}
                    onClick={() => {
                      if (!issue.nodeId) return;
                      const target = nodes.find((n) => n.id === issue.nodeId);
                      if (target) handleNodeSelect(target);
                      setNodes((nds: Node[]) =>
                        nds.map((n) => ({ ...n, selected: n.id === issue.nodeId }))
                      );
                    }}
                    className={`w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                      issue.nodeId ? "cursor-pointer" : "cursor-default"
                    }`}
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
                  </button>
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
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <VariablesPanel nodes={nodes} />
            </div>
            <div className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                Node Configuration
              </h3>
              {selectedNode ? (
                <NodeConfigPanel
                  node={selectedNode}
                  nodes={nodes}
                  onUpdate={handleUpdateNodeData}
                  onDelete={handleDeleteNode}
                />
              ) : (
                <div className="space-y-5">
                  <div className="text-center py-6">
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

                  {/* Module Settings */}
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                    <button
                      onClick={() => setShowModuleSettings((v) => !v)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      <span>Module Settings</span>
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${showModuleSettings ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>

                    {showModuleSettings && (
                      <div className="space-y-3 animate-in slide-in-from-top-1">
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                          When published with a slug, this workflow appears as a standalone module in the sidebar.
                        </p>

                        {/* Slug */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                            URL Slug
                          </label>
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={moduleSlug}
                              onChange={(e) => setModuleSlug(slugify(e.target.value))}
                              placeholder="leave-request"
                              className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => setModuleSlug(slugify(templateName))}
                              className="h-8 px-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                              title="Generate from name"
                            >
                              Auto
                            </button>
                          </div>
                          {moduleSlug && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                              /w/<span className="font-mono text-[#02773b]">{moduleSlug}</span>/inbox
                            </p>
                          )}
                        </div>

                        {/* Instance Name */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                            Instance Label
                          </label>
                          <input
                            type="text"
                            value={moduleInstanceName}
                            onChange={(e) => setModuleInstanceName(e.target.value)}
                            placeholder="e.g. Leave Request"
                            className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                          />
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">
                            Used in sidebar: &quot;New <em>{moduleInstanceName || "Instance"}</em>&quot;
                          </p>
                        </div>

                        {/* Icon picker */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                            Sidebar Icon
                          </label>
                          <div className="grid grid-cols-5 gap-1">
                            {SIDEBAR_ICONS.map((icon) => (
                              <button
                                key={icon.name}
                                type="button"
                                onClick={() => setModuleSidebarIcon(icon.name)}
                                title={icon.label}
                                className={`h-9 rounded-lg border flex items-center justify-center transition-colors ${
                                  moduleSidebarIcon === icon.name
                                    ? "border-[#02773b] bg-[#02773b]/10 text-[#02773b]"
                                    : "border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                                }`}
                              >
                                <WorkflowIcon name={icon.name} className="w-4 h-4" />
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Sidebar order */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                            Sidebar Order
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={moduleSidebarOrder}
                            onChange={(e) => setModuleSidebarOrder(Number(e.target.value))}
                            className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                          />
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">Lower = higher in sidebar</p>
                        </div>

                        {/* Custom sub-views */}
                        <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-800">
                          <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                            Custom Views
                          </label>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">
                            Add filtered views to the sidebar nav.
                          </p>

                          {/* Existing views */}
                          {moduleCustomViews.length > 0 && (
                            <div className="space-y-1">
                              {moduleCustomViews.map((view) => (
                                <div key={view.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{view.label}</p>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{view.filter}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setModuleCustomViews((vs) => vs.filter((v) => v.id !== view.id))}
                                    className="p-0.5 rounded text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add new view form */}
                          {(() => {
                            // Task nodes available on the current canvas
                            const taskNodes = nodes.filter((n) => n.type === "task");
                            const isStepFilter = newViewFilter === "step:";
                            const fieldCls = "w-full h-7 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-[11px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] outline-none";

                            // Group filter options
                            const groups = Array.from(new Set(FILTER_OPTIONS.map((f) => f.group)));

                            return (
                              <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
                                <input
                                  type="text"
                                  value={newViewLabel}
                                  onChange={(e) => setNewViewLabel(e.target.value)}
                                  placeholder="View label (e.g. Pending Approval)"
                                  className={fieldCls}
                                />
                                <input
                                  type="text"
                                  value={newViewDesc}
                                  onChange={(e) => setNewViewDesc(e.target.value)}
                                  placeholder="Description (optional)"
                                  className={fieldCls}
                                />
                                <select
                                  value={newViewFilter}
                                  onChange={(e) => { setNewViewFilter(e.target.value); setNewViewStep(""); }}
                                  className={fieldCls}
                                >
                                  {groups.map((g) => (
                                    <optgroup key={g} label={g}>
                                      {FILTER_OPTIONS.filter((f) => f.group === g).map((f) => (
                                        <option key={f.value} value={f.value}>{f.label}</option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>

                                {/* Step picker — only shown when "At specific step…" is selected */}
                                {isStepFilter && (
                                  <select
                                    value={newViewStep}
                                    onChange={(e) => setNewViewStep(e.target.value)}
                                    className={fieldCls}
                                  >
                                    <option value="">— select a step —</option>
                                    {taskNodes.length === 0 ? (
                                      <option disabled value="">No task nodes on canvas yet</option>
                                    ) : (
                                      taskNodes.map((n) => {
                                        const label = (n.data?.label as string) || n.id;
                                        return (
                                          <option key={n.id} value={label}>{label}</option>
                                        );
                                      })
                                    )}
                                  </select>
                                )}

                                <button
                                  type="button"
                                  disabled={!newViewLabel.trim() || (isStepFilter && !newViewStep)}
                                  onClick={() => {
                                    if (!newViewLabel.trim()) return;
                                    if (isStepFilter && !newViewStep) return;
                                    const filterValue = isStepFilter ? `step:${newViewStep}` : newViewFilter;
                                    setModuleCustomViews((vs) => [
                                      ...vs,
                                      {
                                        id: `view_${Date.now()}`,
                                        label: newViewLabel.trim(),
                                        description: newViewDesc.trim() || undefined,
                                        filter: filterValue,
                                      },
                                    ]);
                                    setNewViewLabel("");
                                    setNewViewDesc("");
                                    setNewViewFilter("all");
                                    setNewViewStep("");
                                  }}
                                  className="w-full h-7 rounded bg-[#02773b]/10 text-[#02773b] text-[11px] font-medium hover:bg-[#02773b]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  + Add View
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
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

      {templateId && (
        <TriggersDialog
          open={showTriggers}
          onClose={() => setShowTriggers(false)}
          templateId={templateId}
          templateName={templateName || "(untitled)"}
        />
      )}

      <SimulatorDialog
        open={showSimulator}
        onClose={() => setShowSimulator(false)}
        nodes={nodes}
        edges={edges}
      />

      <VersionHistoryDialog
        open={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        templateId={templateId}
        currentNodes={nodes}
        currentEdges={edges}
        onRestore={async (definition, version) => {
          if (!templateId) return;
          const res = await fetch(
            `/api/workflows/templates/${templateId}/versions/${version}/restore`,
            { method: "POST" }
          );
          if (!res.ok) throw new Error("Restore failed");
          // Replace the canvas with the restored graph and mark the
          // template as a draft so the user reviews before re-publishing.
          setNodes(definition.nodes ?? []);
          setEdges(definition.edges ?? []);
          setIsPublished(false);
          setSaveMessage({
            type: "success",
            text: `Restored version ${version} as a new draft. Review and publish to make it live.`,
          });
          setTimeout(() => setSaveMessage(null), 5000);
        }}
      />
    </div>
  );
}
