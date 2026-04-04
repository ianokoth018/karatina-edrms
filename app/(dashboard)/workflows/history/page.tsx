"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WorkflowTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment?: string | null;
  assignee: { id: string; name: string; displayName: string };
  assignedAt: string;
  completedAt: string | null;
  dueAt?: string | null;
  delegatedTo?: { id: string; displayName: string } | null;
}

interface WorkflowInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  currentStepIndex: number;
  startedAt: string;
  completedAt: string | null;
  dueAt?: string | null;
  initiatedBy?: { id: string; displayName: string } | null;
  template: { id: string; name: string };
  document: {
    id: string;
    title: string;
    referenceNumber: string;
  } | null;
  tasks: WorkflowTask[];
}

interface TemplateOption {
  id: string;
  name: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Friendly duration between two ISO dates, or from a start to now. */
function duration(start: string, end?: string | null): string {
  const ms =
    (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 0) return "-";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

/** Total workflow duration in hours (numeric, for avg calc). */
function durationHours(start: string, end?: string | null): number {
  const ms =
    (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  return ms / 3600000;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkflowHistoryPage() {
  // Data
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // UI state
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState<{
    id: string;
    subject: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  /* ---- Fetch templates for filter dropdown ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workflows/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(
            (data.templates ?? []).map((t: TemplateOption) => ({
              id: t.id,
              name: t.name,
            }))
          );
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /* ---- Fetch instances ---- */
  const fetchInstances = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (statusFilter) params.set("status", statusFilter);
        if (templateFilter) params.set("templateId", templateFilter);

        const res = await fetch(`/api/workflows?${params}`);
        if (res.ok) {
          const data = await res.json();
          setInstances(data.instances ?? []);
          setPagination(
            data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 }
          );
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, templateFilter]
  );

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  /* ---- Client-side search + date filtering ---- */
  const filtered = useMemo(() => {
    let result = instances;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.referenceNumber.toLowerCase().includes(q) ||
          i.subject.toLowerCase().includes(q) ||
          i.template.name.toLowerCase().includes(q)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      result = result.filter((i) => new Date(i.startedAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000; // end of day
      result = result.filter((i) => new Date(i.startedAt).getTime() <= to);
    }
    return result;
  }, [instances, searchQuery, dateFrom, dateTo]);

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const all = instances;
    const active = all.filter(
      (i) => i.status === "IN_PROGRESS" || i.status === "PENDING"
    );
    const completed = all.filter((i) => i.status === "COMPLETED");
    const rejected = all.filter((i) => i.status === "REJECTED");
    const cancelled = all.filter((i) => i.status === "CANCELLED");

    const completedWithTime = completed.filter((i) => i.completedAt);
    const avgHours =
      completedWithTime.length > 0
        ? completedWithTime.reduce(
            (sum, i) => sum + durationHours(i.startedAt, i.completedAt),
            0
          ) / completedWithTime.length
        : 0;

    let avgLabel = "-";
    if (avgHours > 0) {
      if (avgHours < 1) avgLabel = `${Math.round(avgHours * 60)}m`;
      else if (avgHours < 24) avgLabel = `${avgHours.toFixed(1)}h`;
      else avgLabel = `${(avgHours / 24).toFixed(1)}d`;
    }

    return {
      total: pagination.total,
      active: active.length,
      completed: completed.length,
      rejected: rejected.length,
      cancelled: cancelled.length,
      avgCompletion: avgLabel,
    };
  }, [instances, pagination.total]);

  /* ---- Cancel workflow ---- */
  async function handleCancel() {
    if (!cancelModal || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/workflows/${cancelModal.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      if (res.ok) {
        setCancelModal(null);
        setCancelReason("");
        fetchInstances(pagination.page);
      }
    } catch {
      /* ignore */
    } finally {
      setCancelling(false);
    }
  }

  /* ---- Retry / resubmit rejected workflow ---- */
  function handleResubmit(inst: WorkflowInstance) {
    // Navigate to workflows page with template pre-selected so user can start a new instance
    window.location.href = `/workflows?resubmit=${inst.template.id}&subject=${encodeURIComponent(inst.subject)}`;
  }

  /* ---- CSV export placeholder ---- */
  function handleExportCSV() {
    const header = [
      "Reference",
      "Template",
      "Subject",
      "Status",
      "Initiated",
      "Completed",
      "Duration",
    ];
    const rows = filtered.map((i) => [
      i.referenceNumber,
      i.template.name,
      `"${i.subject.replace(/"/g, '""')}"`,
      i.status,
      formatDate(i.startedAt),
      i.completedAt ? formatDate(i.completedAt) : "-",
      duration(i.startedAt, i.completedAt),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---- SLA compliance per-task ---- */
  function getSlaStatus(task: WorkflowTask): "ok" | "warning" | "breached" {
    if (!task.dueAt) return "ok";
    const due = new Date(task.dueAt).getTime();
    const end = task.completedAt
      ? new Date(task.completedAt).getTime()
      : Date.now();
    if (end > due) return "breached";
    // warning if <20% time remaining
    const assigned = new Date(task.assignedAt).getTime();
    const total = due - assigned;
    const remaining = due - end;
    if (total > 0 && remaining / total < 0.2) return "warning";
    return "ok";
  }

  /* ---- Status badge ---- */
  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      PENDING:
        "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800/50",
      IN_PROGRESS:
        "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800/50",
      COMPLETED:
        "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800/50",
      REJECTED:
        "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/50",
      CANCELLED:
        "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700",
    };
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase ${styles[status] || styles.PENDING}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            status === "COMPLETED"
              ? "bg-emerald-500"
              : status === "IN_PROGRESS"
                ? "bg-blue-500 animate-pulse"
                : status === "REJECTED"
                  ? "bg-red-500"
                  : status === "CANCELLED"
                    ? "bg-gray-400"
                    : "bg-amber-500 animate-pulse"
          }`}
        />
        {status.replace("_", " ")}
      </span>
    );
  }

  /* ---- Timeline node color by action ---- */
  function nodeColor(action: string | null, status: string) {
    if (action === "APPROVED") return "bg-emerald-500";
    if (action === "REJECTED") return "bg-red-500";
    if (action === "RETURNED") return "bg-orange-500";
    if (action === "DELEGATED") return "bg-blue-500";
    if (status === "PENDING") return "bg-gray-400 dark:bg-gray-500";
    if (status === "SKIPPED") return "bg-gray-300 dark:bg-gray-600";
    return "bg-gray-400";
  }

  function nodeRing(action: string | null, status: string) {
    if (action === "APPROVED") return "ring-emerald-200 dark:ring-emerald-900/50";
    if (action === "REJECTED") return "ring-red-200 dark:ring-red-900/50";
    if (action === "RETURNED") return "ring-orange-200 dark:ring-orange-900/50";
    if (action === "DELEGATED") return "ring-blue-200 dark:ring-blue-900/50";
    if (status === "PENDING") return "ring-gray-200 dark:ring-gray-700";
    return "ring-gray-200 dark:ring-gray-700";
  }

  /* ---- Statuses for filter pills ---- */
  const statuses = [
    { label: "All", value: "" },
    { label: "Pending", value: "PENDING" },
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Rejected", value: "REJECTED" },
    { label: "Cancelled", value: "CANCELLED" },
  ];

  const statCards = [
    {
      label: "Total Workflows",
      value: stats.total,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
        </svg>
      ),
      color: "text-[#02773b]",
      bg: "bg-[#02773b]/10 dark:bg-[#02773b]/20",
    },
    {
      label: "Active",
      value: stats.active,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
        </svg>
      ),
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/30",
    },
    {
      label: "Completed",
      value: stats.completed,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      label: "Rejected",
      value: stats.rejected,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/30",
    },
    {
      label: "Cancelled",
      value: stats.cancelled,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
      color: "text-gray-500 dark:text-gray-400",
      bg: "bg-gray-100 dark:bg-gray-800",
    },
    {
      label: "Avg. Completion",
      value: stats.avgCompletion,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      color: "text-[#dd9f42]",
      bg: "bg-[#dd9f42]/10 dark:bg-[#dd9f42]/20",
    },
  ];

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Workflow History
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track every workflow you initiated or participated in
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors self-start sm:self-auto"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* ---- Stats Dashboard ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${card.bg} ${card.color} mb-2`}>
              {card.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {card.value}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* ---- Filters Bar ---- */}
      <div className="space-y-3">
        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          {statuses.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === s.value
                  ? "bg-[#02773b] text-white shadow-sm shadow-[#02773b]/25"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Search + template + date range */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              placeholder="Search by reference, subject, or template..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none transition-colors"
            />
          </div>

          {/* Template filter */}
          <select
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none transition-colors min-w-[180px]"
          >
            <option value="">All Templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none transition-colors"
            title="From date"
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none transition-colors"
            title="To date"
          />
        </div>
      </div>

      {/* ---- Table ---- */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/50">
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  Reference
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  Template
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  Subject
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider hidden lg:table-cell">
                  Duration
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider hidden md:table-cell">
                  Initiated
                </th>
                <th className="text-right px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9.75m3 0-3-3m3 3-3 3M5.25 5.625A3.375 3.375 0 0 1 8.625 2.25h4.5" />
                        </svg>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No workflow instances found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Try adjusting your filters or search query
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((inst) => (
                  <Fragment key={inst.id}>
                    {/* ---- Main row ---- */}
                    <tr
                      className="group hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors cursor-pointer"
                      onClick={() =>
                        setExpandedId(expandedId === inst.id ? null : inst.id)
                      }
                    >
                      {/* Chevron */}
                      <td className="px-3 py-3.5">
                        <svg
                          className={`w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${
                            expandedId === inst.id ? "rotate-90" : ""
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </td>

                      {/* Reference */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-xs text-[#02773b] dark:text-emerald-400 font-semibold">
                          {inst.referenceNumber}
                        </span>
                      </td>

                      {/* Template */}
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#dd9f42] flex-shrink-0" />
                          {inst.template.name}
                        </span>
                      </td>

                      {/* Subject */}
                      <td className="px-4 py-3.5 font-medium text-gray-900 dark:text-gray-100 max-w-[240px] truncate">
                        {inst.subject}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        {getStatusBadge(inst.status)}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400 text-xs font-mono hidden lg:table-cell">
                        {duration(inst.startedAt, inst.completedAt)}
                      </td>

                      {/* Initiated */}
                      <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400 text-xs hidden md:table-cell">
                        {formatDate(inst.startedAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {(inst.status === "IN_PROGRESS" || inst.status === "PENDING") && (
                            <button
                              onClick={() =>
                                setCancelModal({
                                  id: inst.id,
                                  subject: inst.subject,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                              title="Cancel workflow"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                              Cancel
                            </button>
                          )}
                          {inst.status === "REJECTED" && (
                            <button
                              onClick={() => handleResubmit(inst)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[#02773b] dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors"
                              title="Resubmit workflow"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                              </svg>
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ---- Expanded timeline ---- */}
                    {expandedId === inst.id && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="bg-gray-50/50 dark:bg-gray-800/20 border-t border-gray-100 dark:border-gray-800/60">
                            {/* Performance summary bar */}
                            <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800/60 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                              <div>
                                <span className="text-gray-400 dark:text-gray-500">Total Duration:</span>{" "}
                                <span className="font-semibold text-gray-700 dark:text-gray-200">
                                  {duration(inst.startedAt, inst.completedAt)}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 dark:text-gray-500">Steps:</span>{" "}
                                <span className="font-semibold text-gray-700 dark:text-gray-200">
                                  {inst.tasks.filter((t) => t.action).length}/{inst.tasks.length} completed
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400 dark:text-gray-500">Started:</span>{" "}
                                <span className="font-semibold text-gray-700 dark:text-gray-200">
                                  {formatDateTime(inst.startedAt)}
                                </span>
                              </div>
                              {inst.completedAt && (
                                <div>
                                  <span className="text-gray-400 dark:text-gray-500">Ended:</span>{" "}
                                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                                    {formatDateTime(inst.completedAt)}
                                  </span>
                                </div>
                              )}
                              {inst.dueAt && (
                                <div>
                                  <span className="text-gray-400 dark:text-gray-500">SLA Due:</span>{" "}
                                  <span
                                    className={`font-semibold ${
                                      new Date(inst.dueAt).getTime() < Date.now() && !inst.completedAt
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-gray-700 dark:text-gray-200"
                                    }`}
                                  >
                                    {formatDateTime(inst.dueAt)}
                                    {new Date(inst.dueAt).getTime() < Date.now() && !inst.completedAt && " (BREACHED)"}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Visual task chain */}
                            <div className="px-6 py-4">
                              {/* Horizontal step indicators */}
                              <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-2">
                                {inst.tasks.map((task, idx) => (
                                  <Fragment key={task.id}>
                                    <div className="flex flex-col items-center gap-1 min-w-[80px]">
                                      <div
                                        className={`w-8 h-8 rounded-full ring-2 ${nodeColor(task.action, task.status)} ${nodeRing(task.action, task.status)} flex items-center justify-center text-white text-xs font-bold shadow-sm`}
                                      >
                                        {task.action === "APPROVED" ? (
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                          </svg>
                                        ) : task.action === "REJECTED" ? (
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                          </svg>
                                        ) : task.action === "RETURNED" ? (
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                                          </svg>
                                        ) : task.action === "DELEGATED" ? (
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                          </svg>
                                        ) : (
                                          <span>{idx + 1}</span>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400 text-center leading-tight max-w-[80px] truncate">
                                        {task.stepName}
                                      </span>
                                    </div>
                                    {idx < inst.tasks.length - 1 && (
                                      <div
                                        className={`flex-shrink-0 h-0.5 w-8 ${
                                          task.action
                                            ? "bg-emerald-300 dark:bg-emerald-700"
                                            : "bg-gray-200 dark:bg-gray-700"
                                        }`}
                                      />
                                    )}
                                  </Fragment>
                                ))}
                              </div>

                              {/* Detailed vertical timeline */}
                              <div className="space-y-0">
                                {inst.tasks.map((task, idx) => {
                                  const sla = getSlaStatus(task);
                                  return (
                                    <div key={task.id} className="flex gap-3">
                                      {/* Vertical line + dot */}
                                      <div className="flex flex-col items-center w-6 flex-shrink-0">
                                        <div
                                          className={`w-3 h-3 rounded-full mt-1.5 ${nodeColor(task.action, task.status)} ring-2 ring-white dark:ring-gray-900`}
                                        />
                                        {idx < inst.tasks.length - 1 && (
                                          <div className="flex-1 w-px bg-gray-200 dark:bg-gray-700 min-h-[24px]" />
                                        )}
                                      </div>

                                      {/* Content */}
                                      <div className="flex-1 pb-4 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                          <div>
                                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                              {task.stepName}
                                            </span>
                                            {task.action && (
                                              <span
                                                className={`ml-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                  task.action === "APPROVED"
                                                    ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                                                    : task.action === "REJECTED"
                                                      ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                                                      : task.action === "RETURNED"
                                                        ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400"
                                                        : task.action === "DELEGATED"
                                                          ? "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400"
                                                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                                                }`}
                                              >
                                                {task.action}
                                              </span>
                                            )}
                                            {sla === "breached" && (
                                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse">
                                                SLA BREACHED
                                              </span>
                                            )}
                                            {sla === "warning" && (
                                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white">
                                                SLA AT RISK
                                              </span>
                                            )}
                                          </div>
                                          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">
                                            {duration(
                                              task.assignedAt,
                                              task.completedAt
                                            )}
                                          </span>
                                        </div>

                                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                          <span>
                                            Assigned to{" "}
                                            <span className="font-medium text-gray-700 dark:text-gray-300">
                                              {task.assignee.displayName}
                                            </span>
                                          </span>
                                          {task.completedAt && (
                                            <span>
                                              Completed{" "}
                                              {formatDateTime(task.completedAt)}
                                            </span>
                                          )}
                                          {task.dueAt && (
                                            <span>
                                              Due{" "}
                                              {formatDateTime(task.dueAt)}
                                            </span>
                                          )}
                                        </div>

                                        {/* Delegation chain */}
                                        {task.delegatedTo && (
                                          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                            </svg>
                                            <span>
                                              Delegated to{" "}
                                              <span className="font-medium">
                                                {task.delegatedTo.displayName}
                                              </span>
                                            </span>
                                          </div>
                                        )}

                                        {/* Comment */}
                                        {task.comment && (
                                          <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 italic">
                                            &ldquo;{task.comment}&rdquo;
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Pagination ---- */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing{" "}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {(pagination.page - 1) * pagination.limit + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {Math.min(
                  pagination.page * pagination.limit,
                  pagination.total
                )}
              </span>{" "}
              of{" "}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {pagination.total}
              </span>
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => fetchInstances(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => fetchInstances(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Cancel Confirmation Modal ---- */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
            onClick={() => {
              setCancelModal(null);
              setCancelReason("");
            }}
          />

          {/* Modal */}
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Cancel Workflow
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  This will cancel{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    &ldquo;{cancelModal.subject}&rdquo;
                  </span>{" "}
                  and skip all pending tasks. This action cannot be undone.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Reason for cancellation <span className="text-red-500">*</span>
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Provide a reason..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-red-400 focus:ring-2 focus:ring-red-400/20 outline-none resize-none transition-colors"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setCancelModal(null);
                  setCancelReason("");
                }}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Keep Active
              </button>
              <button
                onClick={handleCancel}
                disabled={!cancelReason.trim() || cancelling}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cancelling ? "Cancelling..." : "Cancel Workflow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
