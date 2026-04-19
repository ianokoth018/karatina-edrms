"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Can } from "@/components/auth/can";

/* ------------------------------------------------------------------ */
/*  Type definitions                                                   */
/* ------------------------------------------------------------------ */

interface TaskDocument {
  id: string;
  title: string;
  referenceNumber: string;
  documentType: string;
  department: string;
}

interface TaskInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  template: { id: string; name: string };
  document: TaskDocument | null;
}

interface WorkflowTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment: string | null;
  dueAt: string | null;
  assignedAt: string;
  completedAt: string | null;
  instance: TaskInstance;
  assignee: { id: string; name: string; displayName: string; email: string };
}

interface SlaEntry {
  taskId: string;
  slaStatus: "on_track" | "at_risk" | "breached";
  hoursRemaining: number | null;
  stepName: string;
  instance: {
    id: string;
    referenceNumber: string;
    subject: string;
    templateName: string;
  };
}

interface UserResult {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface TimelineTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  assignee: { id: string; name: string; displayName: string };
  assignedAt: string;
  completedAt: string | null;
}

type TabFilter = "PENDING" | "COMPLETED" | "all";
type SlaFilter = "all" | "on_track" | "at_risk" | "breached";
type ActionType =
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "DELEGATED"
  | "REASSIGN";

/* ------------------------------------------------------------------ */
/*  Inline SVG icon helpers (no external imports)                      */
/* ------------------------------------------------------------------ */

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function IconX({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function IconReturn({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  );
}
function IconDelegate({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}
function IconReassign({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}
function IconChevron({ className = "w-4 h-4", direction = "down" }: { className?: string; direction?: "down" | "up" | "right" }) {
  const rotation = direction === "up" ? "rotate-180" : direction === "right" ? "-rotate-90" : "";
  return (
    <svg className={`${className} ${rotation} transition-transform`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
function IconFilter({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
    </svg>
  );
}
function IconSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
function IconDoc({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
function IconClock({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function WorkflowsPage() {
  const { data: session } = useSession();
  const perms = session?.user?.permissions ?? [];
  const isAdmin = perms.includes("admin:manage");
  const canManage = isAdmin || perms.includes("workflows:manage");
  // ---- Task list state ----
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [activeTab, setActiveTab] = useState<TabFilter>("PENDING");
  const [loading, setLoading] = useState(true);

  // ---- SLA state ----
  const [slaMap, setSlaMap] = useState<Record<string, SlaEntry>>({});

  // ---- Filter state ----
  const [showFilters, setShowFilters] = useState(false);
  const [filterTemplate, setFilterTemplate] = useState("");
  const [filterSla, setFilterSla] = useState<SlaFilter>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // ---- Bulk selection ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // ---- Expanded row ----
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<Record<string, TimelineTask[]>>({});
  const [timelineLoading, setTimelineLoading] = useState(false);

  // ---- Action modal state ----
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ---- User search (for delegate/reassign) ----
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Stats ----
  const [stats, setStats] = useState({ pending: 0, atRisk: 0, breached: 0, completedToday: 0 });

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  const fetchTasks = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
          status: activeTab,
        });
        const res = await fetch(`/api/workflows/tasks?${params}`);
        if (res.ok) {
          const data = await res.json();
          setTasks(data.tasks);
          setPagination(data.pagination);
        }
      } catch {
        /* silently fail */
      } finally {
        setLoading(false);
      }
    },
    [activeTab]
  );

  const fetchSla = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows/sla");
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, SlaEntry> = {};
        for (const entry of data.tasks as SlaEntry[]) {
          map[entry.taskId] = entry;
        }
        setSlaMap(map);
      }
    } catch {
      /* silently fail */
    }
  }, []);

  // Compute stats from the full task list + SLA data
  useEffect(() => {
    const pending = tasks.filter((t) => t.status === "PENDING").length;
    const todayStr = new Date().toISOString().slice(0, 10);
    const completedToday = tasks.filter(
      (t) => t.status === "COMPLETED" && t.completedAt?.startsWith(todayStr)
    ).length;
    const atRisk = tasks.filter((t) => slaMap[t.id]?.slaStatus === "at_risk").length;
    const breached = tasks.filter((t) => slaMap[t.id]?.slaStatus === "breached").length;
    setStats({ pending, atRisk, breached, completedToday });
  }, [tasks, slaMap]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetchSla();
  }, [fetchSla]);

  /* -- Fetch workflow timeline when a row is expanded -- */
  const fetchTimeline = useCallback(
    async (instanceId: string) => {
      if (timelineData[instanceId]) return;
      setTimelineLoading(true);
      try {
        const res = await fetch(`/api/workflows?status=&page=1&limit=100`);
        if (res.ok) {
          const data = await res.json();
          const inst = data.instances?.find(
            (i: { id: string }) => i.id === instanceId
          );
          if (inst?.tasks) {
            setTimelineData((prev) => ({ ...prev, [instanceId]: inst.tasks }));
          }
        }
      } catch {
        /* silently fail */
      } finally {
        setTimelineLoading(false);
      }
    },
    [timelineData]
  );

  /* -- User search debounce -- */
  useEffect(() => {
    if (!userQuery.trim() || userQuery.trim().length < 2) {
      setUserResults([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setUserSearching(true);
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(userQuery)}&limit=8`
        );
        if (res.ok) {
          const data = await res.json();
          setUserResults(data.users ?? []);
        }
      } catch {
        /* silently fail */
      } finally {
        setUserSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [userQuery]);

  /* ================================================================ */
  /*  Filtered tasks (client-side advanced filters)                    */
  /* ================================================================ */

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (filterTemplate) {
      const lower = filterTemplate.toLowerCase();
      list = list.filter((t) =>
        t.instance.template.name.toLowerCase().includes(lower)
      );
    }
    if (filterSla !== "all") {
      list = list.filter((t) => slaMap[t.id]?.slaStatus === filterSla);
    }
    if (filterDateFrom) {
      const from = new Date(filterDateFrom).getTime();
      list = list.filter((t) => new Date(t.assignedAt).getTime() >= from);
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo).getTime() + 86400000;
      list = list.filter((t) => new Date(t.assignedAt).getTime() < to);
    }
    return list;
  }, [tasks, filterTemplate, filterSla, filterDateFrom, filterDateTo, slaMap]);

  /* Unique template names for filter hints */
  const templateNames = useMemo(() => {
    const s = new Set(tasks.map((t) => t.instance.template.name));
    return [...s].sort();
  }, [tasks]);

  /* ================================================================ */
  /*  Actions                                                          */
  /* ================================================================ */

  function openActionModal(task: WorkflowTask, action: ActionType) {
    setSelectedTask(task);
    setActionType(action);
    setComment("");
    setActionError(null);
    setUserQuery("");
    setUserResults([]);
    setSelectedUser(null);
  }

  function closeModal() {
    setSelectedTask(null);
    setActionType(null);
    setComment("");
    setActionError(null);
    setUserQuery("");
    setUserResults([]);
    setSelectedUser(null);
  }

  async function handleAction(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTask || !actionType) return;

    // For delegate/reassign, require user selection
    if (
      (actionType === "DELEGATED" || actionType === "REASSIGN") &&
      !selectedUser
    ) {
      setActionError("Please select a user.");
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      let res: Response;

      if (actionType === "REASSIGN") {
        res = await fetch(
          `/api/workflows/tasks/${selectedTask.id}/reassign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newAssigneeId: selectedUser!.id,
              reason: comment,
            }),
          }
        );
      } else if (actionType === "DELEGATED") {
        res = await fetch(`/api/workflows/tasks/${selectedTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "DELEGATED",
            comment,
            delegateToUserId: selectedUser!.id,
            reason: comment,
          }),
        });
      } else {
        res = await fetch(`/api/workflows/tasks/${selectedTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionType, comment }),
        });
      }

      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || "Failed to process action");
        return;
      }

      closeModal();
      fetchTasks(pagination.page);
      fetchSla();
    } catch {
      setActionError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  /* -- Bulk actions -- */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const pendingIds = filteredTasks
      .filter((t) => t.status === "PENDING")
      .map((t) => t.id);
    if (pendingIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  }

  async function handleBulkAction(action: "APPROVED" | "REJECTED") {
    if (selectedIds.size === 0) return;
    setBulkSubmitting(true);
    const defaultComment =
      action === "APPROVED" ? "Bulk approved." : "Bulk rejected.";
    try {
      await Promise.allSettled(
        [...selectedIds].map((id) =>
          fetch(`/api/workflows/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, comment: defaultComment }),
          })
        )
      );
      setSelectedIds(new Set());
      fetchTasks(pagination.page);
      fetchSla();
    } catch {
      /* silently fail */
    } finally {
      setBulkSubmitting(false);
    }
  }

  /* -- Expand/collapse row -- */
  function handleExpandRow(task: WorkflowTask) {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
    } else {
      setExpandedTaskId(task.id);
      fetchTimeline(task.instance.id);
    }
  }

  /* ================================================================ */
  /*  Helper renderers                                                 */
  /* ================================================================ */

  function getStatusColor(status: string) {
    switch (status) {
      case "PENDING":
        return "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400";
      case "COMPLETED":
        return "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400";
      case "SKIPPED":
        return "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
    }
  }

  function getActionColor(action: string | null) {
    switch (action) {
      case "APPROVED":
        return "text-green-600 dark:text-green-400";
      case "REJECTED":
        return "text-red-600 dark:text-red-400";
      case "RETURNED":
        return "text-amber-600 dark:text-amber-400";
      case "DELEGATED":
        return "text-blue-600 dark:text-blue-400";
      default:
        return "text-gray-500";
    }
  }

  function slaBadge(taskId: string) {
    const sla = slaMap[taskId];
    if (!sla) return null;
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      on_track: {
        bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
        text: "text-emerald-700 dark:text-emerald-400",
        label: "On Track",
      },
      at_risk: {
        bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        label: "At Risk",
      },
      breached: {
        bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
        text: "text-red-700 dark:text-red-400",
        label: "Breached",
      },
    };
    const c = cfg[sla.slaStatus] ?? cfg.on_track;
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${c.bg} ${c.text}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            sla.slaStatus === "on_track"
              ? "bg-emerald-500"
              : sla.slaStatus === "at_risk"
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
        />
        {c.label}
        {sla.hoursRemaining !== null && sla.slaStatus !== "breached" && (
          <span className="opacity-70 ml-0.5">
            {sla.hoursRemaining < 24
              ? `${Math.round(sla.hoursRemaining)}h`
              : `${Math.round(sla.hoursRemaining / 24)}d`}
          </span>
        )}
      </span>
    );
  }

  const modalTitle: Record<ActionType, string> = {
    APPROVED: "Approve Task",
    REJECTED: "Reject Task",
    RETURNED: "Return for Revision",
    DELEGATED: "Delegate Task",
    REASSIGN: "Reassign Task",
  };

  const modalBtnClass: Record<ActionType, string> = {
    APPROVED: "bg-emerald-600 hover:bg-emerald-700",
    REJECTED: "bg-red-600 hover:bg-red-700",
    RETURNED: "bg-amber-600 hover:bg-amber-700",
    DELEGATED: "bg-blue-600 hover:bg-blue-700",
    REASSIGN: "bg-violet-600 hover:bg-violet-700",
  };

  const modalBtnLabel: Record<ActionType, string> = {
    APPROVED: "Approve",
    REJECTED: "Reject",
    RETURNED: "Return",
    DELEGATED: "Delegate",
    REASSIGN: "Reassign",
  };

  const tabs: { label: string; value: TabFilter }[] = [
    { label: "Pending", value: "PENDING" },
    { label: "Completed", value: "COMPLETED" },
    { label: "All", value: "all" },
  ];

  const pendingTaskIds = filteredTasks
    .filter((t) => t.status === "PENDING")
    .map((t) => t.id);
  const allPendingSelected =
    pendingTaskIds.length > 0 &&
    pendingTaskIds.every((id) => selectedIds.has(id));

  const activeFilterCount =
    (filterTemplate ? 1 : 0) +
    (filterSla !== "all" ? 1 : 0) +
    (filterDateFrom ? 1 : 0) +
    (filterDateTo ? 1 : 0);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1440px] mx-auto">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            My Tasks
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Workflow tasks assigned to you
          </p>
        </div>
        <Can permission="workflows:create">
          <Link
            href="/workflows/start"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Start Workflow
          </Link>
        </Can>
      </div>

      {/* ---- Stats cards ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Pending Tasks",
            value: stats.pending,
            icon: (
              <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                <IconClock className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
              </div>
            ),
            accent: "border-l-amber-400",
          },
          {
            label: "At Risk",
            value: stats.atRisk,
            icon: (
              <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
            ),
            accent: "border-l-orange-400",
          },
          {
            label: "Breached",
            value: stats.breached,
            icon: (
              <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
            ),
            accent: "border-l-red-400",
          },
          {
            label: "Completed Today",
            value: stats.completedToday,
            icon: (
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                <IconCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            ),
            accent: "border-l-emerald-400",
          },
        ].map((card) => (
          <div
            key={card.label}
            className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 border-l-4 ${card.accent} rounded-xl p-4 flex items-center gap-3`}
          >
            {card.icon}
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {card.value}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {card.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Tabs + filter toggle ---- */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setActiveTab(tab.value);
                setSelectedIds(new Set());
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.value
                  ? "border-karu-green text-karu-green"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors mb-1 ${
            showFilters || activeFilterCount > 0
              ? "bg-karu-green/10 text-karu-green"
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <IconFilter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 bg-karu-green text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ---- Advanced filters panel ---- */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Template
            </label>
            <select
              value={filterTemplate}
              onChange={(e) => setFilterTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-1 focus:ring-karu-green/30"
            >
              <option value="">All templates</option>
              {templateNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              SLA Status
            </label>
            <select
              value={filterSla}
              onChange={(e) => setFilterSla(e.target.value as SlaFilter)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-1 focus:ring-karu-green/30"
            >
              <option value="all">All</option>
              <option value="on_track">On Track</option>
              <option value="at_risk">At Risk</option>
              <option value="breached">Breached</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Assigned from
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-1 focus:ring-karu-green/30"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Assigned to
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-1 focus:ring-karu-green/30"
            />
          </div>
          {activeFilterCount > 0 && (
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <button
                onClick={() => {
                  setFilterTemplate("");
                  setFilterSla("all");
                  setFilterDateFrom("");
                  setFilterDateTo("");
                }}
                className="text-xs text-karu-green hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Bulk action bar ---- */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-30 bg-karu-green/5 dark:bg-karu-green/10 border border-karu-green/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 animate-in">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {selectedIds.size} task{selectedIds.size > 1 ? "s" : ""} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAction("APPROVED")}
              disabled={bulkSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {bulkSubmitting ? (
                <IconSpinner className="w-3.5 h-3.5" />
              ) : (
                <IconCheck className="w-3.5 h-3.5" />
              )}
              Bulk Approve
            </button>
            <button
              onClick={() => handleBulkAction("REJECTED")}
              disabled={bulkSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {bulkSubmitting ? (
                <IconSpinner className="w-3.5 h-3.5" />
              ) : (
                <IconX className="w-3.5 h-3.5" />
              )}
              Bulk Reject
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ---- Task table ---- */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                {/* Checkbox header */}
                <th className="w-10 px-3 py-3">
                  {activeTab !== "COMPLETED" && pendingTaskIds.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/30 cursor-pointer"
                    />
                  )}
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Reference
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Subject
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Step
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Assigned
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  SLA
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-right px-3 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-3 py-3.5">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-16 text-center text-gray-500 dark:text-gray-400"
                  >
                    <svg
                      className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
                      />
                    </svg>
                    <p className="font-medium">No tasks found</p>
                    <p className="text-xs mt-1">
                      {activeFilterCount > 0
                        ? "Try adjusting your filters."
                        : "New tasks will appear here when assigned."}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => (
                  <>
                    <tr
                      key={task.id}
                      className={`group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${
                        expandedTaskId === task.id
                          ? "bg-gray-50 dark:bg-gray-800/30"
                          : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td
                        className="w-10 px-3 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {task.status === "PENDING" && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelect(task.id)}
                            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/30 cursor-pointer"
                          />
                        )}
                      </td>
                      {/* Reference */}
                      <td
                        className="px-3 py-3"
                        onClick={() => handleExpandRow(task)}
                      >
                        <span className="font-mono text-xs text-karu-green font-medium">
                          {task.instance.referenceNumber}
                        </span>
                      </td>
                      {/* Subject */}
                      <td
                        className="px-3 py-3"
                        onClick={() => handleExpandRow(task)}
                      >
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
                            {task.instance.subject}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {task.instance.template.name}
                          </p>
                        </div>
                      </td>
                      {/* Step */}
                      <td
                        className="px-3 py-3 text-gray-600 dark:text-gray-300 hidden md:table-cell"
                        onClick={() => handleExpandRow(task)}
                      >
                        <span className="text-xs">{task.stepName}</span>
                      </td>
                      {/* Assigned */}
                      <td
                        className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 hidden lg:table-cell"
                        onClick={() => handleExpandRow(task)}
                      >
                        {new Date(task.assignedAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      {/* SLA */}
                      <td
                        className="px-3 py-3 hidden lg:table-cell"
                        onClick={() => handleExpandRow(task)}
                      >
                        {task.status === "PENDING" ? slaBadge(task.id) : (
                          <span className="text-xs text-gray-400">--</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-3 py-3" onClick={() => handleExpandRow(task)}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(
                            task.status
                          )}`}
                        >
                          {task.status}
                        </span>
                        {task.action && (
                          <span
                            className={`block text-[11px] mt-0.5 ${getActionColor(
                              task.action
                            )}`}
                          >
                            {task.action}
                          </span>
                        )}
                      </td>
                      {/* Actions */}
                      <td
                        className="px-3 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {task.status === "PENDING" ? (
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <button
                              onClick={() => openActionModal(task, "APPROVED")}
                              title="Approve"
                              className="px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                            >
                              <IconCheck className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                              <span className="hidden xl:inline">Approve</span>
                            </button>
                            <button
                              onClick={() => openActionModal(task, "REJECTED")}
                              title="Reject"
                              className="px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                            >
                              <IconX className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                              <span className="hidden xl:inline">Reject</span>
                            </button>
                            <button
                              onClick={() => openActionModal(task, "RETURNED")}
                              title="Return"
                              className="px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                            >
                              <IconReturn className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                              <span className="hidden xl:inline">Return</span>
                            </button>
                            <button
                              onClick={() => openActionModal(task, "DELEGATED")}
                              title="Delegate"
                              className="px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                            >
                              <IconDelegate className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                              <span className="hidden xl:inline">Delegate</span>
                            </button>
                            <button
                              onClick={() => openActionModal(task, "REASSIGN")}
                              title="Reassign"
                              className="px-2 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 text-xs font-medium hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors"
                            >
                              <IconReassign className="w-3.5 h-3.5 inline -mt-0.5" />{" "}
                              <span className="hidden xl:inline">Reassign</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {task.completedAt
                              ? new Date(task.completedAt).toLocaleDateString(
                                  "en-GB",
                                  { day: "2-digit", month: "short" }
                                )
                              : "--"}
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* ---- Expanded detail row ---- */}
                    {expandedTaskId === task.id && (
                      <tr key={`${task.id}-expanded`}>
                        <td
                          colSpan={8}
                          className="bg-gray-50/70 dark:bg-gray-800/20 px-4 py-5 border-b border-gray-200 dark:border-gray-800"
                        >
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                            {/* Left: details */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Task Details
                              </h4>
                              <dl className="space-y-2 text-sm">
                                <div className="flex gap-2">
                                  <dt className="text-gray-500 dark:text-gray-400 w-24 shrink-0">Subject</dt>
                                  <dd className="text-gray-900 dark:text-gray-100 font-medium">{task.instance.subject}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="text-gray-500 dark:text-gray-400 w-24 shrink-0">Step</dt>
                                  <dd className="text-gray-900 dark:text-gray-100">{task.stepName} (#{task.stepIndex})</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="text-gray-500 dark:text-gray-400 w-24 shrink-0">Assignee</dt>
                                  <dd className="text-gray-900 dark:text-gray-100">{task.assignee.displayName || task.assignee.name}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="text-gray-500 dark:text-gray-400 w-24 shrink-0">Due</dt>
                                  <dd className="text-gray-900 dark:text-gray-100">
                                    {task.dueAt
                                      ? new Date(task.dueAt).toLocaleDateString("en-GB", {
                                          day: "2-digit",
                                          month: "short",
                                          year: "numeric",
                                        })
                                      : "No deadline"}
                                  </dd>
                                </div>
                                {task.comment && (
                                  <div className="flex gap-2">
                                    <dt className="text-gray-500 dark:text-gray-400 w-24 shrink-0">Comment</dt>
                                    <dd className="text-gray-700 dark:text-gray-300 italic">&ldquo;{task.comment}&rdquo;</dd>
                                  </div>
                                )}
                              </dl>
                              {/* Document link */}
                              {task.instance.document && (
                                <Link
                                  href={`/documents/${task.instance.document.id}`}
                                  className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg bg-karu-green/10 text-karu-green text-xs font-medium hover:bg-karu-green/20 transition-colors"
                                >
                                  <IconDoc className="w-3.5 h-3.5" />
                                  View Document: {task.instance.document.referenceNumber}
                                </Link>
                              )}
                              {/* SLA inline for mobile */}
                              <div className="lg:hidden mt-2">
                                {task.status === "PENDING" && slaBadge(task.id)}
                              </div>
                            </div>

                            {/* Center: workflow timeline */}
                            <div className="lg:col-span-2 space-y-3">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                Workflow Timeline
                              </h4>
                              {timelineLoading && !timelineData[task.instance.id] ? (
                                <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                                  <IconSpinner className="w-4 h-4" /> Loading
                                  timeline...
                                </div>
                              ) : timelineData[task.instance.id] ? (
                                <div className="relative pl-5">
                                  {/* Vertical line */}
                                  <div className="absolute left-[9px] top-1 bottom-1 w-px bg-gray-200 dark:bg-gray-700" />
                                  <div className="space-y-3">
                                    {timelineData[task.instance.id].map((step) => {
                                      const isCurrent = step.id === task.id;
                                      const isDone = step.status === "COMPLETED";
                                      const isSkipped = step.status === "SKIPPED";
                                      return (
                                        <div
                                          key={step.id}
                                          className="relative flex items-start gap-3"
                                        >
                                          {/* Dot */}
                                          <div
                                            className={`absolute -left-5 top-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center ${
                                              isDone
                                                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                                                : isSkipped
                                                  ? "border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800"
                                                  : isCurrent
                                                    ? "border-karu-gold bg-karu-gold/10"
                                                    : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                                            }`}
                                          >
                                            {isDone && (
                                              <IconCheck className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                                            )}
                                            {isCurrent && !isDone && (
                                              <div className="w-2 h-2 rounded-full bg-karu-gold animate-pulse" />
                                            )}
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <p
                                              className={`text-sm font-medium ${
                                                isCurrent
                                                  ? "text-karu-gold"
                                                  : isDone
                                                    ? "text-gray-700 dark:text-gray-300"
                                                    : "text-gray-400 dark:text-gray-500"
                                              }`}
                                            >
                                              {step.stepName}
                                              {step.action && (
                                                <span
                                                  className={`ml-2 text-[11px] font-semibold ${getActionColor(
                                                    step.action
                                                  )}`}
                                                >
                                                  {step.action}
                                                </span>
                                              )}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                              {step.assignee.displayName || step.assignee.name}
                                              {step.completedAt && (
                                                <span className="ml-2">
                                                  {new Date(
                                                    step.completedAt
                                                  ).toLocaleDateString("en-GB", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                  })}
                                                </span>
                                              )}
                                            </p>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 py-4">
                                  No timeline data available.
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Pagination ---- */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => fetchTasks(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              {/* Page number pills */}
              {Array.from({ length: Math.min(pagination.totalPages, 5) }).map(
                (_, i) => {
                  const p =
                    pagination.totalPages <= 5
                      ? i + 1
                      : Math.max(
                          1,
                          Math.min(
                            pagination.page - 2,
                            pagination.totalPages - 4
                          )
                        ) + i;
                  return (
                    <button
                      key={p}
                      onClick={() => fetchTasks(p)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        pagination.page === p
                          ? "bg-karu-green text-white"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {p}
                    </button>
                  );
                }
              )}
              <button
                onClick={() => fetchTasks(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Unified Action Modal                                            */}
      {/* ================================================================ */}

      {selectedTask && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg animate-scale-in overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {modalTitle[actionType]}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {selectedTask.instance.subject} &mdash; {selectedTask.stepName}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAction} className="p-6 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {actionError}
                  </p>
                </div>
              )}

              {/* User search for DELEGATED / REASSIGN */}
              {(actionType === "DELEGATED" || actionType === "REASSIGN") && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    {actionType === "DELEGATED"
                      ? "Delegate to"
                      : "Reassign to"}{" "}
                    <span className="text-red-500">*</span>
                  </label>

                  {selectedUser ? (
                    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 border border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {selectedUser.displayName || selectedUser.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {selectedUser.email}
                          {selectedUser.department &&
                            ` - ${selectedUser.department}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUser(null);
                          setUserQuery("");
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <IconX className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                        {userSearching ? (
                          <IconSpinner className="w-4 h-4 text-gray-400" />
                        ) : (
                          <IconSearch className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <input
                        type="text"
                        value={userQuery}
                        onChange={(e) => setUserQuery(e.target.value)}
                        placeholder="Search by name, email, department..."
                        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                        autoFocus
                      />
                      {/* Dropdown results */}
                      {userResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto">
                          {userResults.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                setSelectedUser(u);
                                setUserResults([]);
                                setUserQuery("");
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors first:rounded-t-xl last:rounded-b-xl"
                            >
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {u.displayName || u.name}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {u.email}
                                {u.department && ` - ${u.department}`}
                                {u.jobTitle && ` - ${u.jobTitle}`}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                      {userQuery.length >= 2 &&
                        !userSearching &&
                        userResults.length === 0 && (
                          <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg px-4 py-3">
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                              No users found
                            </p>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* Comment / reason */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {actionType === "DELEGATED" || actionType === "REASSIGN"
                    ? "Reason"
                    : "Comment"}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                  rows={3}
                  placeholder={
                    actionType === "APPROVED"
                      ? "Approved. Looks good."
                      : actionType === "REJECTED"
                        ? "Reason for rejection..."
                        : actionType === "RETURNED"
                          ? "What needs to be revised..."
                          : actionType === "DELEGATED"
                            ? "Reason for delegation..."
                            : "Reason for reassignment..."
                  }
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
                />
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    !comment.trim() ||
                    ((actionType === "DELEGATED" || actionType === "REASSIGN") &&
                      !selectedUser)
                  }
                  className={`px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 ${modalBtnClass[actionType]}`}
                >
                  {submitting && <IconSpinner className="w-4 h-4" />}
                  {modalBtnLabel[actionType]}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
