"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TemplateNode {
  id: string;
  type: "start" | "end" | "task" | "decision" | "parallel" | "timer" | "email" | "system" | "subprocess";
  position: { x: number; y: number };
  data: {
    label?: string;
    taskType?: "approval" | "review" | "notification" | "action";
    description?: string;
    assigneeRule?: "specific_user" | "role_based" | "department" | "initiator" | "initiator_manager" | "round_robin" | "least_loaded" | "dynamic";
    assigneeValue?: string;
    escalationDays?: number;
    formTemplateId?: string;
    approvalRule?: "all" | "any" | "majority";
    parallelApproval?: boolean;
    [key: string]: unknown;
  };
}

interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
}

interface TemplateLegacyStep {
  index: number;
  name: string;
  type: "approval" | "review" | "notification";
}

interface TemplateDefinition {
  nodes?: TemplateNode[];
  edges?: TemplateEdge[];
  steps?: TemplateLegacyStep[];
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  definition: TemplateDefinition;
  version: number;
}

interface UserOption {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle?: string | null;
}

interface DocumentOption {
  id: string;
  title: string;
  referenceNumber: string;
}

/** Resolved task step extracted from either nodes/edges or legacy steps. */
interface ResolvedStep {
  stepIndex: number;
  stepName: string;
  taskType: string;
  description: string;
  assigneeRule: string;
  assigneeValue: string;
  formTemplateId: string;
  nodeId: string;
  nodeType: string;
}

/** For the minimap flow visualization */
interface FlowNode {
  id: string;
  type: string;
  label: string;
  children: string[];
  depth: number;
}

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type WizardStep = 1 | 2 | 3 | 4;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractStepsFromDefinition(def: TemplateDefinition): ResolvedStep[] {
  const defNodes = def.nodes;
  const defEdges = def.edges;

  if (!defNodes?.length || !defEdges?.length) {
    // Fall back to legacy steps
    return (def.steps ?? []).map((s, i) => ({
      stepIndex: i,
      stepName: s.name,
      taskType: s.type,
      description: "",
      assigneeRule: "dynamic",
      assigneeValue: "",
      formTemplateId: "",
      nodeId: `legacy_${i}`,
      nodeType: "task",
    }));
  }

  const adj: Record<string, string[]> = {};
  for (const e of defEdges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  const startNodes = defNodes.filter((n) => n.type === "start");
  if (startNodes.length === 0) return [];

  const visited = new Set<string>();
  const queue = [...startNodes.map((n) => n.id)];
  const tasks: ResolvedStep[] = [];
  let stepIndex = 0;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = defNodes.find((n) => n.id === currentId);
    if (!currentNode) continue;

    if (currentNode.type === "task") {
      tasks.push({
        stepIndex: stepIndex++,
        stepName: (currentNode.data.label as string) || "Untitled",
        taskType: (currentNode.data.taskType as string) || "approval",
        description: (currentNode.data.description as string) || "",
        assigneeRule: (currentNode.data.assigneeRule as string) || "dynamic",
        assigneeValue: (currentNode.data.assigneeValue as string) || "",
        formTemplateId: (currentNode.data.formTemplateId as string) || "",
        nodeId: currentNode.id,
        nodeType: currentNode.type,
      });
    }

    const children = adj[currentId] ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }

  return tasks;
}

function buildFlowGraph(def: TemplateDefinition): FlowNode[] {
  const defNodes = def.nodes;
  const defEdges = def.edges;

  if (!defNodes?.length || !defEdges?.length) {
    // Legacy steps: linear chain
    const steps = def.steps ?? [];
    if (steps.length === 0) return [];
    const flowNodes: FlowNode[] = [
      { id: "start", type: "start", label: "Start", children: steps.length > 0 ? [`step_0`] : [], depth: 0 },
    ];
    steps.forEach((s, i) => {
      flowNodes.push({
        id: `step_${i}`,
        type: "task",
        label: s.name,
        children: i < steps.length - 1 ? [`step_${i + 1}`] : ["end"],
        depth: i + 1,
      });
    });
    flowNodes.push({ id: "end", type: "end", label: "End", children: [], depth: steps.length + 1 });
    return flowNodes;
  }

  const adj: Record<string, string[]> = {};
  for (const e of defEdges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  // BFS to assign depths
  const startNodes = defNodes.filter((n) => n.type === "start");
  const depthMap: Record<string, number> = {};
  const bfsQueue: [string, number][] = startNodes.map((n) => [n.id, 0]);
  const visited = new Set<string>();

  while (bfsQueue.length > 0) {
    const [nid, depth] = bfsQueue.shift()!;
    if (visited.has(nid)) continue;
    visited.add(nid);
    depthMap[nid] = depth;
    for (const child of (adj[nid] ?? [])) {
      if (!visited.has(child)) bfsQueue.push([child, depth + 1]);
    }
  }

  return defNodes
    .filter((n) => visited.has(n.id))
    .map((n) => ({
      id: n.id,
      type: n.type,
      label: (n.data?.label as string) || n.type.charAt(0).toUpperCase() + n.type.slice(1),
      children: adj[n.id] ?? [],
      depth: depthMap[n.id] ?? 0,
    }))
    .sort((a, b) => a.depth - b.depth);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const assigneeRuleLabels: Record<string, string> = {
  specific_user: "Specific User",
  role_based: "Role-Based",
  department: "Department",
  initiator: "Initiator",
  initiator_manager: "Manager",
  round_robin: "Round Robin",
  least_loaded: "Least Loaded",
  dynamic: "Manual Selection",
};

const priorityConfig: Record<Priority, { label: string; color: string; bg: string; ring: string; icon: string }> = {
  LOW: { label: "Low", color: "text-gray-500 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-800", ring: "ring-gray-300 dark:ring-gray-600", icon: "M19 14l-7 7m0 0l-7-7m7 7V3" },
  NORMAL: { label: "Normal", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", ring: "ring-blue-300 dark:ring-blue-700", icon: "M5 12h14" },
  HIGH: { label: "High", color: "text-karu-gold", bg: "bg-karu-gold-light dark:bg-karu-gold/10", ring: "ring-karu-gold/40", icon: "M5 10l7-7m0 0l7 7m-7-7v18" },
  URGENT: { label: "Urgent", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", ring: "ring-red-400 dark:ring-red-700", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" },
};

const nodeTypeVisual: Record<string, { bg: string; border: string; icon: string }> = {
  start: { bg: "bg-emerald-100 dark:bg-emerald-900/40", border: "border-emerald-400 dark:border-emerald-600", icon: "M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" },
  end: { bg: "bg-red-100 dark:bg-red-900/40", border: "border-red-400 dark:border-red-600", icon: "M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" },
  task: { bg: "bg-blue-100 dark:bg-blue-900/40", border: "border-blue-400 dark:border-blue-600", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" },
  decision: { bg: "bg-amber-100 dark:bg-amber-900/40", border: "border-amber-400 dark:border-amber-600", icon: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" },
  parallel: { bg: "bg-indigo-100 dark:bg-indigo-900/40", border: "border-indigo-400 dark:border-indigo-600", icon: "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" },
  timer: { bg: "bg-cyan-100 dark:bg-cyan-900/40", border: "border-cyan-400 dark:border-cyan-600", icon: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  email: { bg: "bg-pink-100 dark:bg-pink-900/40", border: "border-pink-400 dark:border-pink-600", icon: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" },
  subprocess: { bg: "bg-violet-100 dark:bg-violet-900/40", border: "border-violet-400 dark:border-violet-600", icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" },
  system: { bg: "bg-gray-100 dark:bg-gray-800", border: "border-gray-400 dark:border-gray-600", icon: "M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" },
};

const taskTypeColors: Record<string, { dot: string; label: string }> = {
  approval: { dot: "bg-amber-500", label: "Approval" },
  review: { dot: "bg-blue-500", label: "Review" },
  notification: { dot: "bg-purple-500", label: "Notification" },
  action: { dot: "bg-teal-500", label: "Action" },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StartWorkflowPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    const perms = session?.user?.permissions ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("workflows:create")) {
      router.replace("/workflows");
    }
  }, [session, status, router]);

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Step 1: Template selection
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");

  // Step 2: Details
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [dueDate, setDueDate] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentOption | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  // Step 3: Assignees
  const [assignees, setAssignees] = useState<Record<number, UserOption | null>>({});
  const [userSearches, setUserSearches] = useState<Record<number, string>>({});
  const [userResults, setUserResults] = useState<Record<number, UserOption[]>>({});
  const [userSearchLoading, setUserSearchLoading] = useState<Record<number, boolean>>({});
  const [focusedStep, setFocusedStep] = useState<number | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Derived data
  const resolvedSteps = useMemo(() => {
    if (!selectedTemplate) return [];
    return extractStepsFromDefinition(selectedTemplate.definition);
  }, [selectedTemplate]);

  const flowGraph = useMemo(() => {
    if (!selectedTemplate) return [];
    return buildFlowGraph(selectedTemplate.definition);
  }, [selectedTemplate]);

  const isVisualTemplate = useMemo(() => {
    return !!(selectedTemplate?.definition?.nodes?.length && selectedTemplate?.definition?.edges?.length);
  }, [selectedTemplate]);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }, [templates, templateSearch]);

  // Fetch templates on mount
  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/workflows/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates);
        }
      } catch {
        // silently fail
      } finally {
        setTemplatesLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  // Search documents (debounced)
  const searchDocuments = useCallback(async (query: string) => {
    if (!query.trim()) {
      setDocuments([]);
      return;
    }
    setDocumentsLoading(true);
    try {
      const params = new URLSearchParams({ q: query, limit: "10" });
      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(
          (data.documents ?? []).map((d: DocumentOption) => ({
            id: d.id,
            title: d.title,
            referenceNumber: d.referenceNumber,
          }))
        );
      }
    } catch {
      // silently fail
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (documentSearch.trim()) searchDocuments(documentSearch);
      else setDocuments([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [documentSearch, searchDocuments]);

  // Search users for a step (supports department/role-filtered searching)
  const searchUsers = useCallback(async (stepIndex: number, query: string, department?: string) => {
    if (!query.trim() && !department) {
      setUserResults((prev) => ({ ...prev, [stepIndex]: [] }));
      return;
    }
    setUserSearchLoading((prev) => ({ ...prev, [stepIndex]: true }));
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (query.trim()) params.set("q", query);
      if (department) params.set("department", department);
      const res = await fetch(`/api/users/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUserResults((prev) => ({
          ...prev,
          [stepIndex]: (data.users ?? []).map((u: UserOption) => ({
            id: u.id,
            name: u.name,
            displayName: u.displayName,
            email: u.email,
            department: u.department,
            jobTitle: u.jobTitle,
          })),
        }));
      }
    } catch {
      // silently fail
    } finally {
      setUserSearchLoading((prev) => ({ ...prev, [stepIndex]: false }));
    }
  }, []);

  // Debounced user search
  useEffect(() => {
    if (focusedStep === null) return;
    const query = userSearches[focusedStep] ?? "";
    const step = resolvedSteps.find((s) => s.stepIndex === focusedStep);
    const department = step?.assigneeRule === "department" ? step.assigneeValue : undefined;
    const timer = setTimeout(() => {
      searchUsers(focusedStep, query, department);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearches, focusedStep, searchUsers, resolvedSteps]);

  // Initialize assignees when template changes
  useEffect(() => {
    if (selectedTemplate && resolvedSteps.length > 0) {
      const initial: Record<number, UserOption | null> = {};
      for (const step of resolvedSteps) {
        // Auto-assign initiator steps
        if (step.assigneeRule === "initiator" && session?.user) {
          initial[step.stepIndex] = {
            id: session.user.id,
            name: session.user.name ?? "",
            displayName: session.user.name ?? session.user.email ?? "",
            email: session.user.email ?? "",
            department: null,
          };
        } else {
          initial[step.stepIndex] = null;
        }
      }
      setAssignees(initial);
      setUserSearches({});
      setUserResults({});
    }
  }, [selectedTemplate, resolvedSteps, session]);

  function canProceed(): boolean {
    switch (currentStep) {
      case 1:
        return selectedTemplate !== null;
      case 2:
        return subject.trim().length > 0;
      case 3:
        return resolvedSteps.every(
          (step) => assignees[step.stepIndex] !== null && assignees[step.stepIndex] !== undefined
        );
      case 4:
        return true;
      default:
        return false;
    }
  }

  function goNext() {
    if (currentStep < 4 && canProceed()) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  }

  function goBack() {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  }

  async function handleSubmit() {
    if (!selectedTemplate || !subject.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const assigneePayload = resolvedSteps.map((step) => ({
        userId: assignees[step.stepIndex]!.id,
        stepIndex: step.stepIndex,
        stepName: step.stepName,
      }));

      const payload: Record<string, unknown> = {
        templateId: selectedTemplate.id,
        documentId: selectedDocument?.id ?? undefined,
        subject: subject.trim(),
        priority,
      };

      if (dueDate) {
        payload.dueDate = new Date(dueDate).toISOString();
      }

      if (isVisualTemplate) {
        payload.useTemplateDefinition = true;
        payload.dynamicAssignees = assigneePayload.map((a) => ({
          stepIndex: a.stepIndex,
          userId: a.userId,
        }));
      } else {
        payload.assignees = assigneePayload;
      }

      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error || "Failed to start workflow");
        return;
      }

      setShowSuccess(true);
      setTimeout(() => {
        router.push("/workflows");
      }, 1500);
    } catch {
      setSubmitError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const estimatedDays = useMemo(() => {
    if (!resolvedSteps.length) return 0;
    return resolvedSteps.length * 2; // rough estimate: 2 days per step
  }, [resolvedSteps]);

  const stepLabels = ["Select Template", "Workflow Details", "Assign People", "Review & Launch"];

  /* ---------------------------------------------------------------- */
  /*  Visual flow minimap renderer                                     */
  /* ---------------------------------------------------------------- */
  function renderFlowMinimap(compact = false) {
    if (flowGraph.length === 0) return null;

    const maxDepth = Math.max(...flowGraph.map((n) => n.depth));
    const depthGroups: Record<number, FlowNode[]> = {};
    for (const node of flowGraph) {
      if (!depthGroups[node.depth]) depthGroups[node.depth] = [];
      depthGroups[node.depth].push(node);
    }

    return (
      <div className={`${compact ? "py-2" : "py-4"} overflow-x-auto`}>
        <div className="flex items-start gap-1 min-w-max px-2">
          {Array.from({ length: maxDepth + 1 }, (_, depth) => {
            const group = depthGroups[depth] ?? [];
            return (
              <div key={depth} className="flex flex-col items-center gap-1">
                {/* Nodes at this depth */}
                {group.map((node) => {
                  const visual = nodeTypeVisual[node.type] ?? nodeTypeVisual.system;
                  return (
                    <div key={node.id} className="flex items-center gap-1">
                      {depth > 0 && (
                        <svg className="w-4 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" viewBox="0 0 16 12">
                          <path d="M0 6h12m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      <div
                        className={`${compact ? "px-2 py-1" : "px-3 py-1.5"} rounded-lg border ${visual.bg} ${visual.border} flex items-center gap-1.5 min-w-0`}
                        title={node.label}
                      >
                        <svg className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} flex-shrink-0`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d={visual.icon} />
                        </svg>
                        <span className={`${compact ? "text-[10px]" : "text-xs"} font-medium truncate max-w-[100px]`}>
                          {node.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Start New Workflow
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure and launch a workflow from a template
          </p>
        </div>
        <button
          onClick={() => router.push("/workflows")}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Back to workflows"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Success toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-slide-up">
          <div className="bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-xl px-5 py-4 shadow-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">Workflow launched successfully</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Redirecting to workflows...</p>
            </div>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepLabels.map((label, idx) => {
          const stepNum = (idx + 1) as WizardStep;
          const isActive = currentStep === stepNum;
          const isCompleted = currentStep > stepNum;
          return (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 transition-all duration-200 ${
                    isCompleted
                      ? "bg-karu-green text-white shadow-sm"
                      : isActive
                        ? "bg-karu-green text-white shadow-md shadow-karu-green/30"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={`text-sm font-medium truncate hidden sm:block transition-colors ${
                    isActive
                      ? "text-karu-green"
                      : isCompleted
                        ? "text-gray-700 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < stepLabels.length - 1 && (
                <div
                  className={`flex-1 h-0.5 rounded-full transition-colors ${
                    isCompleted ? "bg-karu-green" : "bg-gray-200 dark:bg-gray-700"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">

        {/* ============================================================ */}
        {/* Step 1: Select Template                                      */}
        {/* ============================================================ */}
        {currentStep === 1 && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Select a Workflow Template
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Choose a template to define the workflow steps and routing.
              </p>
            </div>

            {/* Search */}
            <div className="relative">
              <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </div>
              <input
                type="text"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Search templates by name or description..."
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
              {templateSearch && (
                <button
                  onClick={() => setTemplateSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {templatesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-40 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9.75m3 0H9.75m0 0v3.75M5.625 5.25A2.625 2.625 0 0 1 8.25 2.625h7.5a2.625 2.625 0 0 1 2.625 2.625v14.25a2.625 2.625 0 0 1-2.625 2.625H8.25a2.625 2.625 0 0 1-2.625-2.625V5.25Z" />
                </svg>
                {templateSearch ? (
                  <>
                    <p className="text-gray-500 dark:text-gray-400">No templates matching &quot;{templateSearch}&quot;</p>
                    <button onClick={() => setTemplateSearch("")} className="text-xs text-karu-green mt-1 hover:underline">Clear search</button>
                  </>
                ) : (
                  <>
                    <p className="text-gray-500 dark:text-gray-400">No workflow templates available.</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Contact an administrator to create templates.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.map((template) => {
                  const steps = extractStepsFromDefinition(template.definition);
                  const hasVisualDef = !!(template.definition?.nodes?.length && template.definition?.edges?.length);
                  const allNodeCount = template.definition?.nodes?.length ?? 0;
                  const isSelected = selectedTemplate?.id === template.id;

                  return (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 group ${
                        isSelected
                          ? "border-karu-green bg-karu-green-light dark:bg-karu-green/10 shadow-md shadow-karu-green/10"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`text-sm font-semibold truncate ${isSelected ? "text-karu-green" : "text-gray-900 dark:text-gray-100"}`}>
                              {template.name}
                            </h3>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex-shrink-0">
                              v{template.version}
                            </span>
                          </div>
                          {template.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
                              {template.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
                              </svg>
                              {steps.length} task{steps.length !== 1 ? "s" : ""}
                            </span>
                            {hasVisualDef && (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                </svg>
                                {allNodeCount} node{allNodeCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {hasVisualDef && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-karu-green-light dark:bg-karu-green/10 text-karu-green">
                                Visual
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Selection indicator */}
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                          isSelected
                            ? "border-karu-green bg-karu-green"
                            : "border-gray-300 dark:border-gray-600 group-hover:border-gray-400 dark:group-hover:border-gray-500"
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* Step preview pills */}
                      {steps.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
                          {steps.slice(0, 5).map((step, idx) => {
                            const tc = taskTypeColors[step.taskType] ?? taskTypeColors.approval;
                            return (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800 text-[10px]"
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${tc.dot} flex-shrink-0`} />
                                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[80px]">{step.stepName}</span>
                              </span>
                            );
                          })}
                          {steps.length > 5 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1 py-0.5">
                              +{steps.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Flow preview for selected template */}
            {selectedTemplate && flowGraph.length > 0 && (
              <div className="mt-2 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Workflow Flow Preview
                  </h4>
                </div>
                {renderFlowMinimap()}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* Step 2: Workflow Details                                      */}
        {/* ============================================================ */}
        {currentStep === 2 && (
          <div className="p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Workflow Details
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Provide a subject, priority, and optionally attach a document.
              </p>
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Budget Approval for Q2 2026"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Description <span className="text-xs text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional context or notes for this workflow..."
                rows={3}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
              />
            </div>

            {/* Priority & Due Date row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Priority selector */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Priority
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(priorityConfig) as Priority[]).map((p) => {
                    const cfg = priorityConfig[p];
                    const isActive = priority === p;
                    return (
                      <button
                        key={p}
                        onClick={() => setPriority(p)}
                        className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 transition-all text-center ${
                          isActive
                            ? `${cfg.bg} border-current ${cfg.color} ring-1 ${cfg.ring}`
                            : "border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
                        </svg>
                        <span className="text-[10px] font-semibold">{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Due date */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Due Date <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                />
                {dueDate && (
                  <button
                    onClick={() => setDueDate("")}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Clear due date
                  </button>
                )}
              </div>
            </div>

            {/* Document attachment */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Attach Document <span className="text-xs text-gray-400 font-normal">(optional)</span>
              </label>

              {selectedDocument ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-karu-green bg-karu-green-light dark:bg-karu-green/10">
                  <svg className="w-5 h-5 text-karu-green flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {selectedDocument.title}
                    </p>
                    <p className="text-xs text-karu-green font-mono">
                      {selectedDocument.referenceNumber}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedDocument(null);
                      setDocumentSearch("");
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={documentSearch}
                    onChange={(e) => setDocumentSearch(e.target.value)}
                    placeholder="Search documents by title or reference..."
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />

                  {(documents.length > 0 || documentsLoading) && documentSearch.trim() && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {documentsLoading ? (
                        <div className="p-3 text-center text-sm text-gray-400">Searching...</div>
                      ) : (
                        documents.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => {
                              setSelectedDocument(doc);
                              setDocumentSearch("");
                              setDocuments([]);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b last:border-b-0 border-gray-100 dark:border-gray-700 flex items-center gap-3"
                          >
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {doc.title}
                              </p>
                              <p className="text-xs text-karu-green font-mono mt-0.5">
                                {doc.referenceNumber}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Step 3: Assign People                                        */}
        {/* ============================================================ */}
        {currentStep === 3 && selectedTemplate && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Assign People
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Configure who handles each step. Some steps may be pre-configured by the template.
              </p>
            </div>

            {/* Visual minimap */}
            {flowGraph.length > 0 && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3">
                {renderFlowMinimap(true)}
              </div>
            )}

            {/* Assignee cards */}
            <div className="space-y-3">
              {resolvedSteps.map((step, idx) => {
                const rule = step.assigneeRule;
                const isReadOnly = rule === "specific_user" || rule === "initiator";
                const isInitiator = rule === "initiator";
                const tc = taskTypeColors[step.taskType] ?? taskTypeColors.approval;
                const assignee = assignees[step.stepIndex];

                return (
                  <div
                    key={step.stepIndex}
                    className={`rounded-xl border transition-colors ${
                      assignee
                        ? "border-karu-green/30 bg-karu-green-light/50 dark:bg-karu-green/5"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    {/* Step header */}
                    <div className="flex items-center gap-3 p-4 pb-0">
                      <div className="w-7 h-7 rounded-full bg-karu-green/10 text-karu-green text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {step.stepName}
                          </h3>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`} />
                            {tc.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">
                            {assigneeRuleLabels[rule] ?? rule}
                            {rule === "role_based" && step.assigneeValue && (
                              <span className="ml-1 text-karu-gold font-medium">{step.assigneeValue}</span>
                            )}
                            {rule === "department" && step.assigneeValue && (
                              <span className="ml-1 text-karu-gold font-medium">{step.assigneeValue}</span>
                            )}
                          </span>
                          {step.formTemplateId && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 1 15 2.25h-1.5a2.251 2.251 0 0 1-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
                              </svg>
                              Includes form
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Assignee picker / display */}
                    <div className="p-4 pt-3">
                      {/* Read-only display for specific_user or initiator */}
                      {isReadOnly && assignee ? (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                          <div className="w-8 h-8 rounded-full bg-karu-green flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                            {getInitials(assignee.displayName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {assignee.displayName}
                              {isInitiator && (
                                <span className="ml-2 text-[10px] text-karu-green font-normal">(You)</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{assignee.email}</p>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                          </svg>
                        </div>
                      ) : assignee ? (
                        /* Assigned user (removable) */
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-karu-green-light dark:bg-karu-green/10 border border-karu-green/20">
                          <div className="w-8 h-8 rounded-full bg-karu-green flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                            {getInitials(assignee.displayName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {assignee.displayName}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {assignee.email}
                              {assignee.department && <span className="ml-1 text-gray-400">({assignee.department})</span>}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setAssignees((prev) => ({ ...prev, [step.stepIndex]: null }));
                              setUserSearches((prev) => ({ ...prev, [step.stepIndex]: "" }));
                            }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        /* User search input */
                        <div className="relative">
                          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                          </div>
                          <input
                            type="text"
                            value={userSearches[step.stepIndex] ?? ""}
                            onChange={(e) => {
                              setUserSearches((prev) => ({ ...prev, [step.stepIndex]: e.target.value }));
                              setFocusedStep(step.stepIndex);
                            }}
                            onFocus={() => {
                              setFocusedStep(step.stepIndex);
                              // Auto-search for department-based steps
                              if (rule === "department" && step.assigneeValue && !userSearches[step.stepIndex]) {
                                searchUsers(step.stepIndex, "", step.assigneeValue);
                              }
                            }}
                            placeholder={
                              rule === "department" && step.assigneeValue
                                ? `Search in ${step.assigneeValue} department...`
                                : rule === "role_based" && step.assigneeValue
                                  ? `Search users with role: ${step.assigneeValue}...`
                                  : "Search by name or email..."
                            }
                            className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                          />

                          {/* User results dropdown */}
                          {focusedStep === step.stepIndex && (userResults[step.stepIndex]?.length > 0 || userSearchLoading[step.stepIndex]) && (
                            <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                              {userSearchLoading[step.stepIndex] ? (
                                <div className="p-3 text-center text-sm text-gray-400">Searching...</div>
                              ) : (
                                userResults[step.stepIndex].map((user) => (
                                  <button
                                    key={user.id}
                                    onClick={() => {
                                      setAssignees((prev) => ({ ...prev, [step.stepIndex]: user }));
                                      setFocusedStep(null);
                                      setUserSearches((prev) => ({ ...prev, [step.stepIndex]: "" }));
                                      setUserResults((prev) => ({ ...prev, [step.stepIndex]: [] }));
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b last:border-b-0 border-gray-100 dark:border-gray-700 flex items-center gap-3"
                                  >
                                    <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
                                      {getInitials(user.displayName)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                        {user.displayName}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {user.email}
                                        {user.department && ` - ${user.department}`}
                                      </p>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Completion summary */}
            {resolvedSteps.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 pt-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                {Object.values(assignees).filter(Boolean).length} of {resolvedSteps.length} steps assigned
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* Step 4: Review & Launch                                      */}
        {/* ============================================================ */}
        {currentStep === 4 && selectedTemplate && (
          <div className="p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Review & Launch
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Verify everything looks correct before starting the workflow.
              </p>
            </div>

            {submitError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 flex items-center gap-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Template & Subject summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Template
                  </h3>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {selectedTemplate.name}
                  </p>
                  {selectedTemplate.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {selectedTemplate.description}
                    </p>
                  )}
                  <span className="inline-block text-[10px] font-mono text-gray-400">v{selectedTemplate.version}</span>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Subject
                  </h3>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {subject}
                  </p>
                  {description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{description}</p>
                  )}
                </div>
              </div>

              {/* Priority, Due Date, Document row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Priority
                  </h3>
                  <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 ${priorityConfig[priority].color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d={priorityConfig[priority].icon} />
                    </svg>
                    <span className={`text-sm font-medium ${priorityConfig[priority].color}`}>
                      {priorityConfig[priority].label}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Due Date
                  </h3>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {dueDate
                      ? new Date(dueDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
                      : "Auto (7 days)"}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Estimated Completion
                  </h3>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    ~{estimatedDays} business day{estimatedDays !== 1 ? "s" : ""}
                  </p>
                  <p className="text-[10px] text-gray-400">{resolvedSteps.length} step{resolvedSteps.length !== 1 ? "s" : ""} at ~2 days each</p>
                </div>
              </div>

              {/* Attached document */}
              {selectedDocument && (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Attached Document
                  </h3>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-karu-green flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedDocument.title}</span>
                    <span className="text-xs text-karu-green font-mono">{selectedDocument.referenceNumber}</span>
                  </div>
                </div>
              )}

              {/* Visual flow */}
              {flowGraph.length > 0 && (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-2">
                  <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Workflow Flow
                  </h3>
                  {renderFlowMinimap(true)}
                </div>
              )}

              {/* Steps & Assignees */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-3">
                <h3 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Steps & Assignees
                </h3>
                <div className="space-y-2">
                  {resolvedSteps.map((step, idx) => {
                    const user = assignees[step.stepIndex];
                    const tc = taskTypeColors[step.taskType] ?? taskTypeColors.approval;
                    return (
                      <div key={step.stepIndex} className="flex items-center gap-3 py-1.5">
                        <div className="w-6 h-6 rounded-full bg-karu-green/10 text-karu-green text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${tc.dot} flex-shrink-0`} />
                          <span className="text-sm text-gray-900 dark:text-gray-100 font-medium truncate">
                            {step.stepName}
                          </span>
                          {step.formTemplateId && (
                            <svg className="w-3 h-3 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 1 15 2.25h-1.5a2.251 2.251 0 0 1-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                          <svg className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                          {user ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-karu-green flex items-center justify-center text-white text-[8px] font-semibold flex-shrink-0">
                                {getInitials(user.displayName)}
                              </div>
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
                                {user.displayName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-red-400">Not assigned</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={goBack}
          disabled={currentStep === 1}
          className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-3">
          {/* Step info */}
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
            Step {currentStep} of 4
          </span>

          {currentStep < 4 ? (
            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="px-5 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              Continue
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !canProceed()}
              className="px-6 py-2.5 rounded-xl bg-karu-green text-white text-sm font-semibold hover:bg-karu-green-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm hover:shadow-md"
            >
              {submitting ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
              )}
              Launch Workflow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
