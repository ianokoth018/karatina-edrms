"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TemplateStep {
  index: number;
  name: string;
  type: "approval" | "review" | "notification";
}

interface DesignerNode {
  id: string;
  type: string;
  data?: { label?: string; nodeType?: string };
}

interface TemplateDefinition {
  steps?: TemplateStep[];
  nodes?: DesignerNode[];
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  definition: TemplateDefinition;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  instanceCount: number;
  completedInstances: number;
}

type StatusFilter = "all" | "active" | "inactive";

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

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Count node types from definition (supports both step-array and designer-graph formats) */
function countNodes(def: TemplateDefinition) {
  let tasks = 0;
  let decisions = 0;
  let timers = 0;
  let notifications = 0;

  if (def.nodes?.length) {
    for (const n of def.nodes) {
      const t = (n.data?.nodeType ?? n.type ?? "").toLowerCase();
      if (t.includes("decision") || t.includes("gateway") || t.includes("condition")) decisions++;
      else if (t.includes("timer") || t.includes("delay") || t.includes("wait")) timers++;
      else if (t.includes("notification") || t.includes("email") || t.includes("notify")) notifications++;
      else if (!["start", "end"].includes(t)) tasks++;
    }
  } else if (def.steps?.length) {
    for (const s of def.steps) {
      if (s.type === "notification") notifications++;
      else tasks++;
    }
  }

  return { tasks, decisions, timers, notifications };
}

function completionRate(completed: number, total: number) {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Tiny inline SVG flow preview */
function MiniFlowPreview({ definition }: { definition: TemplateDefinition }) {
  const steps = definition.steps ?? [];
  const nodes = definition.nodes ?? [];
  const items: { label: string; type: string }[] = [];

  if (nodes.length) {
    for (const n of nodes) {
      const t = (n.data?.nodeType ?? n.type ?? "").toLowerCase();
      if (["start", "end"].includes(t)) continue;
      items.push({ label: n.data?.label ?? n.type ?? "?", type: t });
    }
  } else {
    for (const s of steps) {
      items.push({ label: s.name, type: s.type });
    }
  }

  if (items.length === 0) {
    return (
      <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
        No steps defined
      </span>
    );
  }

  const shown = items.slice(0, 5);
  const overflow = items.length - shown.length;

  return (
    <div className="flex items-center gap-0.5 overflow-hidden">
      {shown.map((item, i) => (
        <div key={i} className="flex items-center gap-0.5 flex-shrink-0">
          <div
            title={item.label}
            className={`h-5 px-1.5 rounded text-[9px] font-medium leading-5 truncate max-w-[72px] ${
              item.type.includes("decision") || item.type.includes("gateway")
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                : item.type.includes("timer") || item.type.includes("delay")
                  ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400"
                  : item.type === "notification" || item.type.includes("email")
                    ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400"
                    : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {item.label}
          </div>
          {i < shown.length - 1 && (
            <svg className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 ml-0.5 flex-shrink-0">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** Skeleton card for loading state */
function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>
      <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
        <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
      </div>
      <div className="h-5 w-full bg-gray-100 dark:bg-gray-800 rounded mb-4" />
      <div className="flex gap-2">
        <div className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
        <div className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
      </div>
    </div>
  );
}

/** Delete confirmation modal */
function DeleteModal({
  templateName,
  onConfirm,
  onCancel,
  deleting,
}: {
  templateName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-6 animate-scale-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Deactivate Template</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              This will deactivate <span className="font-medium text-gray-700 dark:text-gray-300">&ldquo;{templateName}&rdquo;</span>. Existing instances will not be affected.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {deleting && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Deactivate
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function WorkflowTemplatesPage() {
  const { data: session } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Actions state
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Dropdown menu
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  /* ---- Fetch ---- */
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workflows/templates?all=true");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = () => setOpenMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openMenu]);

  /* ---- Filtered list ---- */
  const filtered = useMemo(() => {
    let list = templates;
    if (statusFilter === "active") list = list.filter((t) => t.isActive);
    if (statusFilter === "inactive") list = list.filter((t) => !t.isActive);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [templates, search, statusFilter]);

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const total = templates.length;
    const active = templates.filter((t) => t.isActive).length;
    const totalInstances = templates.reduce((s, t) => s + t.instanceCount, 0);
    return { total, active, totalInstances };
  }, [templates]);

  /* ---- Actions ---- */
  async function handleToggleActive(template: Template) {
    setToggling(template.id);
    try {
      const res = await fetch(`/api/workflows/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !template.isActive }),
      });
      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === template.id ? { ...t, isActive: !t.isActive } : t
          )
        );
      }
    } catch {
      /* silent */
    } finally {
      setToggling(null);
    }
  }

  async function handleDuplicate(template: Template) {
    setDuplicating(template.id);
    try {
      const res = await fetch("/api/workflows/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${template.name} (Copy)`,
          description: template.description ?? undefined,
          definition: template.definition,
        }),
      });
      if (res.ok) {
        await fetchTemplates();
      }
    } catch {
      /* silent */
    } finally {
      setDuplicating(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflows/templates/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === deleteTarget.id ? { ...t, isActive: false } : t
          )
        );
      }
    } catch {
      /* silent */
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  /* ---- Permission gate ---- */
  const hasPermission = session?.user?.permissions?.includes("workflows:manage");

  if (!hasPermission) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to manage workflow templates.
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="p-6 space-y-6">
      {/* ---------- Header ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Workflow Templates
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Design, manage, and monitor reusable workflow templates
          </p>
        </div>
        <Link
          href="/workflows/designer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors shadow-sm"
          style={{ backgroundColor: "#02773b" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#025e2f")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#02773b")}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Template
        </Link>
      </div>

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: "Total Templates",
            value: stats.total,
            icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            ),
            color: "text-[#02773b]",
            bg: "bg-[#02773b]/10",
          },
          {
            label: "Active",
            value: stats.active,
            icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            ),
            color: "text-emerald-600 dark:text-emerald-400",
            bg: "bg-emerald-100 dark:bg-emerald-900/30",
          },
          {
            label: "Total Instances",
            value: stats.totalInstances,
            icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            ),
            color: "text-[#dd9f42]",
            bg: "bg-[#dd9f42]/10",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-4"
          >
            <div className={`w-10 h-10 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center flex-shrink-0`}>
              {stat.icon}
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? "--" : stat.value}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Search & Filter ---------- */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 pl-10 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
          />
        </div>
        <div className="inline-flex rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-0.5 self-start">
          {(["all", "active", "inactive"] as StatusFilter[]).map((val) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                statusFilter === val
                  ? "bg-[#02773b] text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Grid ---------- */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
          <svg className="w-14 h-14 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
            {search || statusFilter !== "all" ? "No templates match your filters" : "No templates yet"}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
            {search || statusFilter !== "all"
              ? "Try adjusting your search or filter"
              : "Create your first workflow template to get started"}
          </p>
          {!search && statusFilter === "all" && (
            <Link
              href="/workflows/designer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: "#02773b" }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Template
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((template) => {
            const counts = countNodes(template.definition);
            const rate = completionRate(template.completedInstances, template.instanceCount);
            const isMenuOpen = openMenu === template.id;

            return (
              <div
                key={template.id}
                className={`group relative rounded-2xl border bg-white dark:bg-gray-900 p-5 transition-all hover:shadow-md ${
                  template.isActive
                    ? "border-gray-200 dark:border-gray-800"
                    : "border-dashed border-gray-300 dark:border-gray-700 opacity-75"
                }`}
              >
                {/* Top row: name + menu */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate leading-snug">
                      {template.name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-relaxed min-h-[2rem]">
                      {template.description || "No description"}
                    </p>
                  </div>

                  {/* Three-dot menu */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenu(isMenuOpen ? null : template.id);
                      }}
                      className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                      </svg>
                    </button>

                    {isMenuOpen && (
                      <div
                        className="absolute right-0 top-8 z-30 w-48 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 animate-in fade-in slide-in-from-top-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          href={`/workflows/designer?template=${template.id}`}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                          </svg>
                          Edit in Designer
                        </Link>
                        <Link
                          href={`/workflows/start?template=${template.id}`}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                          </svg>
                          Start Workflow
                        </Link>
                        <Link
                          href={`/workflows/history?template=${template.id}`}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          View Instances
                        </Link>

                        <div className="border-t border-gray-100 dark:border-gray-800 my-1" />

                        <button
                          onClick={() => {
                            setOpenMenu(null);
                            handleDuplicate(template);
                          }}
                          disabled={duplicating === template.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                          </svg>
                          {duplicating === template.id ? "Duplicating..." : "Duplicate"}
                        </button>
                        <button
                          onClick={() => {
                            setOpenMenu(null);
                            handleToggleActive(template);
                          }}
                          disabled={toggling === template.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            {template.isActive ? (
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                            ) : (
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            )}
                          </svg>
                          {toggling === template.id
                            ? "Updating..."
                            : template.isActive
                              ? "Deactivate"
                              : "Activate"}
                        </button>

                        {template.isActive && (
                          <>
                            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                            <button
                              onClick={() => {
                                setOpenMenu(null);
                                setDeleteTarget(template);
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Badges row: version + status */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    v{template.version}
                  </span>
                  <button
                    onClick={() => handleToggleActive(template)}
                    disabled={toggling === template.id}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed ${
                      template.isActive
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                    title={`Click to ${template.isActive ? "deactivate" : "activate"}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${template.isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
                    {template.isActive ? "Active" : "Inactive"}
                  </button>
                </div>

                {/* Node breakdown */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {counts.tasks > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                      {counts.tasks} task{counts.tasks !== 1 ? "s" : ""}
                    </span>
                  )}
                  {counts.decisions > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                      </svg>
                      {counts.decisions} decision{counts.decisions !== 1 ? "s" : ""}
                    </span>
                  )}
                  {counts.timers > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                      {counts.timers} timer{counts.timers !== 1 ? "s" : ""}
                    </span>
                  )}
                  {counts.notifications > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                      </svg>
                      {counts.notifications} notif{counts.notifications !== 1 ? "s" : ""}
                    </span>
                  )}
                  {counts.tasks === 0 && counts.decisions === 0 && counts.timers === 0 && counts.notifications === 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">No nodes</span>
                  )}
                </div>

                {/* Mini flow preview */}
                <div className="mb-4 py-2.5 px-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                  <MiniFlowPreview definition={template.definition} />
                </div>

                {/* Usage metrics */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                    </svg>
                    <span className="font-medium">{template.instanceCount}</span> instance{template.instanceCount !== 1 ? "s" : ""}
                  </div>
                  {template.instanceCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${rate}%`,
                            backgroundColor: rate >= 75 ? "#02773b" : rate >= 40 ? "#dd9f42" : "#ef4444",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                        {rate}% done
                      </span>
                    </div>
                  )}
                </div>

                {/* Dates */}
                <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-4">
                  <span>Created {formatDate(template.createdAt)}</span>
                  <span>Updated {formatRelative(template.updatedAt)}</span>
                </div>

                {/* Version history placeholder */}
                <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <span className="font-medium">Version {template.version}</span>
                  <button className="underline hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors cursor-default" title="Version comparison coming soon">
                    Compare versions
                  </button>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/workflows/designer?template=${template.id}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors"
                    style={{ borderColor: "#02773b", color: "#02773b" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#02773b";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "#02773b";
                    }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                    Edit
                  </Link>
                  <Link
                    href={`/workflows/start?template=${template.id}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white transition-colors"
                    style={{ backgroundColor: "#02773b" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#025e2f")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#02773b")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                    </svg>
                    Start
                  </Link>
                  <Link
                    href={`/workflows/history?template=${template.id}`}
                    className="inline-flex items-center justify-center p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    title="View instances"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Delete confirmation modal ---------- */}
      {deleteTarget && (
        <DeleteModal
          templateName={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
