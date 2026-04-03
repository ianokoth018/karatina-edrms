"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  fields: unknown[];
  isActive: boolean;
  version: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  submissionCount: number;
}

/* ------------------------------------------------------------------ */
/*  Icons (inline SVG)                                                 */
/* ------------------------------------------------------------------ */

function IconPlus({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconSearch({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconDocument({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconInbox({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-17.5 0V6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v6.75m-19.5 0v4.5A2.25 2.25 0 0 1 4.5 20.25h15a2.25 2.25 0 0 0 2.25-2.25v-4.5" />
    </svg>
  );
}

function IconPause({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconPencil({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function IconClipboard({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75" />
    </svg>
  );
}

function IconList({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function IconToggle({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconEmpty({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={0.75} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton loader                                                    */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="h-7 w-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-56 bg-gray-200 dark:bg-gray-800 rounded-lg mt-2" />
        </div>
        <div className="h-10 w-40 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800" />
        ))}
      </div>

      {/* Filter skeleton */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="h-10 flex-1 max-w-sm bg-gray-200 dark:bg-gray-800 rounded-xl" />
        <div className="h-10 w-36 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-64 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm modal                                                      */
/* ------------------------------------------------------------------ */

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  confirmClass,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-xl text-white transition-colors ${confirmClass ?? "bg-red-600 hover:bg-red-700"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

type StatusFilter = "all" | "active" | "inactive";

export default function FormsPage() {
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [deleteTarget, setDeleteTarget] = useState<FormTemplate | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  /* ---------- fetch ---------- */

  const fetchForms = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/forms");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load forms (${res.status})`);
      }
      const data = await res.json();
      setForms(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  /* ---------- actions ---------- */

  const toggleActive = async (form: FormTemplate) => {
    setToggling((prev) => new Set(prev).add(form.id));
    try {
      const res = await fetch(`/api/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !form.isActive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update form");
      }
      setForms((prev) =>
        prev.map((f) => (f.id === form.id ? { ...f, isActive: !f.isActive } : f)),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle form status");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(form.id);
        return next;
      });
    }
  };

  const deleteForm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/forms/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete form");
      }
      setForms((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete form");
    } finally {
      setDeleting(false);
    }
  };

  /* ---------- derived ---------- */

  const filtered = forms.filter((f) => {
    const matchesSearch =
      !search ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      (f.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && f.isActive) ||
      (statusFilter === "inactive" && !f.isActive);
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: forms.length,
    active: forms.filter((f) => f.isActive).length,
    inactive: forms.filter((f) => !f.isActive).length,
    submissions: forms.reduce((sum, f) => sum + f.submissionCount, 0),
  };

  /* ---------- format date ---------- */

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  /* ---------- render ---------- */

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Forms
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Design and manage electronic forms
          </p>
        </div>
        <Link
          href="/forms/designer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
        >
          <IconPlus className="w-4 h-4" />
          Create New Form
        </Link>
      </div>

      {/* ---- Error banner ---- */}
      {error && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchForms();
              }}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ---- Stats row ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Forms",
            value: stats.total,
            icon: <IconDocument className="w-5 h-5" />,
            color: "text-[#02773b] bg-[#02773b]/10",
          },
          {
            label: "Active",
            value: stats.active,
            icon: <IconCheck className="w-5 h-5" />,
            color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
          },
          {
            label: "Submissions",
            value: stats.submissions,
            icon: <IconInbox className="w-5 h-5" />,
            color: "text-[#dd9f42] bg-[#dd9f42]/10",
          },
          {
            label: "Inactive",
            value: stats.inactive,
            icon: <IconPause className="w-5 h-5" />,
            color: "text-gray-500 bg-gray-100 dark:bg-gray-800",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 flex items-start gap-3"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.color}`}>
              {stat.icon}
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stat.value.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {stat.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Filter bar ---- */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search forms..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* ---- Content ---- */}
      {forms.length === 0 && !error ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#02773b]/10 flex items-center justify-center mb-6">
            <IconEmpty className="w-10 h-10 text-[#02773b]" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No forms yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            Design electronic forms with custom fields, validation rules, and
            workflow integrations to digitise your processes.
          </p>
          <Link
            href="/forms/designer"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            <IconPlus className="w-4 h-4" />
            Create your first form
          </Link>
        </div>
      ) : filtered.length === 0 && forms.length > 0 ? (
        /* No results for filter */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <IconSearch className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            No forms match your filters
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Try adjusting the search term or status filter.
          </p>
          <button
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            className="mt-4 text-sm font-medium text-[#02773b] hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        /* Cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((form) => {
            const fieldCount = Array.isArray(form.fields) ? form.fields.length : 0;
            const isToggling = toggling.has(form.id);

            return (
              <div
                key={form.id}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-[#02773b]/30 dark:hover:border-[#02773b]/30 transition-all hover:shadow-md flex flex-col"
              >
                {/* Card body */}
                <div className="p-5 flex-1 space-y-3">
                  {/* Top row: name + badge */}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                      {form.name}
                    </h3>
                    <span
                      className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
                        form.isActive
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {form.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                    {form.description || "No description"}
                  </p>

                  {/* Meta chips */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
                      v{form.version}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
                      {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#dd9f42] bg-[#dd9f42]/10 px-2 py-1 rounded-lg">
                      {form.submissionCount} {form.submissionCount === 1 ? "submission" : "submissions"}
                    </span>
                  </div>

                  {/* Date */}
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Created {formatDate(form.createdAt)}
                  </p>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-100 dark:border-gray-800" />

                {/* Actions row */}
                <div className="px-4 py-3 flex items-center gap-1">
                  <Link
                    href={`/forms/designer?id=${form.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="Edit form design"
                  >
                    <IconPencil />
                    Edit
                  </Link>
                  <Link
                    href={`/forms/${form.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="Fill out this form"
                  >
                    <IconClipboard />
                    Fill
                  </Link>
                  <Link
                    href={`/forms/${form.id}/submissions`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="View submissions"
                  >
                    <IconList />
                    <span className="hidden sm:inline">Submissions</span>
                  </Link>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Toggle active */}
                  <button
                    onClick={() => toggleActive(form)}
                    disabled={isToggling}
                    className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                      form.isActive
                        ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    }`}
                    title={form.isActive ? "Deactivate" : "Activate"}
                  >
                    <IconToggle />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setDeleteTarget(form)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Delete form"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Delete confirmation modal ---- */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete form"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        confirmClass="bg-red-600 hover:bg-red-700"
        onConfirm={deleteForm}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
