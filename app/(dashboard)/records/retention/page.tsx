"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Can } from "@/components/auth/can";

/* ---------- types ---------- */

interface ClassificationNode {
  id: string;
  code: string;
  title: string;
  level: number;
}

interface Schedule {
  id: string;
  classificationNodeId: string;
  classificationNode: { code: string; title: string };
  activeYears: number;
  inactiveYears: number;
  totalYears: number;
  disposalAction: DisposalAction;
  legalBasis: string | null;
}

type DisposalAction = "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW";

/* ---------- constants ---------- */

const DISPOSAL_ACTIONS: { value: DisposalAction; label: string }[] = [
  { value: "DESTROY", label: "Destroy" },
  { value: "ARCHIVE_PERMANENT", label: "Archive Permanent" },
  { value: "REVIEW", label: "Review" },
];

const ACTION_BADGE: Record<DisposalAction, string> = {
  DESTROY:
    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  ARCHIVE_PERMANENT:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  REVIEW:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
};

const ACTION_LABEL: Record<DisposalAction, string> = {
  DESTROY: "Destroy",
  ARCHIVE_PERMANENT: "Archive Permanent",
  REVIEW: "Review",
};

/* ---------- icons (inline SVG helpers) ---------- */

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function CalendarClockIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
  );
}

function FireIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

/* ---------- searchable select ---------- */

function ClassificationSelect({
  nodes,
  value,
  onChange,
}: {
  nodes: ClassificationNode[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return nodes;
    const q = query.toLowerCase();
    return nodes.filter(
      (n) =>
        n.code.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q)
    );
  }, [nodes, query]);

  const selected = nodes.find((n) => n.id === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setQuery("");
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-left text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none flex items-center justify-between gap-2"
      >
        <span className={selected ? "" : "text-gray-400 dark:text-gray-500"}>
          {selected ? `${selected.code} - ${selected.title}` : "Select classification node..."}
        </span>
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-64 flex flex-col animate-scale-in">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <div className="relative">
              <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                <SearchIcon />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or title..."
                className="w-full h-8 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 pl-8 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green focus:ring-1 focus:ring-karu-green/20"
              />
            </div>
          </div>

          {/* Options */}
          <div className="overflow-y-auto flex-1 p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">
                No classification nodes found
              </div>
            ) : (
              filtered.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => {
                    onChange(node.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    node.id === value
                      ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  <span className="font-mono text-xs text-gray-500 dark:text-gray-400 mr-2">
                    {node.code}
                  </span>
                  {node.title}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- main page ---------- */

export default function RetentionSchedulesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "loading") return;
    const p = session?.user?.permissions ?? [];
    if (!p.includes("admin:manage") && !p.includes("records_retention:read")) router.replace("/records/casefolders");
  }, [session, status, router]);
  /* ---- data state ---- */
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [nodes, setNodes] = useState<ClassificationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- filter state ---- */
  const [filterAction, setFilterAction] = useState<DisposalAction | "">("");

  /* ---- modal state ---- */
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* form fields */
  const [formNodeId, setFormNodeId] = useState("");
  const [formActiveYears, setFormActiveYears] = useState<number | "">(0);
  const [formInactiveYears, setFormInactiveYears] = useState<number | "">(0);
  const [formAction, setFormAction] = useState<DisposalAction>("DESTROY");
  const [formLegalBasis, setFormLegalBasis] = useState("");

  /* ---- delete modal state ---- */
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* ---- computed ---- */
  const computedTotal =
    (typeof formActiveYears === "number" ? formActiveYears : 0) +
    (typeof formInactiveYears === "number" ? formInactiveYears : 0);

  const filteredSchedules = useMemo(() => {
    if (!filterAction) return schedules;
    return schedules.filter((s) => s.disposalAction === filterAction);
  }, [schedules, filterAction]);

  const stats = useMemo(() => {
    const total = schedules.length;
    const destroy = schedules.filter((s) => s.disposalAction === "DESTROY").length;
    const archive = schedules.filter((s) => s.disposalAction === "ARCHIVE_PERMANENT").length;
    const review = schedules.filter((s) => s.disposalAction === "REVIEW").length;
    return { total, destroy, archive, review };
  }, [schedules]);

  /* ---- fetch schedules ---- */
  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/records/retention");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to fetch retention schedules");
      }
      const data = await res.json();
      setSchedules(data.schedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- fetch classification nodes ---- */
  const fetchNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/records/classification?flat=true");
      if (res.ok) {
        const data = await res.json();
        setNodes(data.nodes);
      }
    } catch {
      /* silent - dropdown will be empty */
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
    fetchNodes();
  }, [fetchSchedules, fetchNodes]);

  /* ---- modal helpers ---- */
  function openCreateModal() {
    setEditingSchedule(null);
    setFormNodeId("");
    setFormActiveYears(0);
    setFormInactiveYears(0);
    setFormAction("DESTROY");
    setFormLegalBasis("");
    setFormError(null);
    setShowFormModal(true);
  }

  function openEditModal(schedule: Schedule) {
    setEditingSchedule(schedule);
    setFormNodeId(schedule.classificationNodeId);
    setFormActiveYears(schedule.activeYears);
    setFormInactiveYears(schedule.inactiveYears);
    setFormAction(schedule.disposalAction);
    setFormLegalBasis(schedule.legalBasis ?? "");
    setFormError(null);
    setShowFormModal(true);
  }

  function closeFormModal() {
    setShowFormModal(false);
    setEditingSchedule(null);
  }

  /* ---- submit create/edit ---- */
  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    if (!formNodeId) {
      setFormError("Please select a classification node");
      setSaving(false);
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        classificationNodeId: formNodeId,
        activeYears: typeof formActiveYears === "number" ? formActiveYears : 0,
        inactiveYears: typeof formInactiveYears === "number" ? formInactiveYears : 0,
        disposalAction: formAction,
      };
      if (formLegalBasis.trim()) {
        payload.legalBasis = formLegalBasis.trim();
      }

      const url = editingSchedule
        ? `/api/records/retention/${editingSchedule.id}`
        : "/api/records/retention";
      const method = editingSchedule ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? `Failed to ${editingSchedule ? "update" : "create"} schedule`
        );
      }

      closeFormModal();
      fetchSchedules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  /* ---- delete ---- */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/records/retention/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete schedule");
      }
      setDeleteTarget(null);
      fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  /* ---------- render ---------- */
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Retention Schedules
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Define how long records are kept and what happens when they expire
          </p>
        </div>
        <Can anyOf={["records:create", "records:manage"]}>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 whitespace-nowrap"
          >
            <PlusIcon />
            New Schedule
          </button>
        </Can>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up delay-100">
        {/* Total */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-karu-green-light dark:bg-karu-green/10 flex items-center justify-center text-karu-green">
              <CalendarClockIcon />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? "-" : stats.total}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Schedules</p>
            </div>
          </div>
        </div>

        {/* Destroy */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center text-red-500">
              <FireIcon />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? "-" : stats.destroy}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Destroy</p>
            </div>
          </div>
        </div>

        {/* Archive Permanent */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center text-blue-500">
              <ArchiveIcon />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? "-" : stats.archive}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Archive Permanent</p>
            </div>
          </div>
        </div>

        {/* Review */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center text-amber-500">
              <EyeIcon />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? "-" : stats.review}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Review</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 animate-slide-up delay-200">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Disposal Action
            </label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value as DisposalAction | "")}
              className="h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
            >
              <option value="">All actions</option>
              {DISPOSAL_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          {filterAction && (
            <button
              onClick={() => setFilterAction("")}
              className="h-9 px-3 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Clear filter
            </button>
          )}

          <div className="ml-auto text-xs text-gray-400 dark:text-gray-500 self-center">
            {filteredSchedules.length} schedule{filteredSchedules.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertIcon />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 rounded-lg text-red-400 hover:text-red-600 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-300">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Classification
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Active Yrs
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Inactive Yrs
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Total Yrs
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Disposal Action
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Legal Basis
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${40 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <EmptyIcon />
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No retention schedules found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {filterAction
                          ? "Try clearing the filter"
                          : "Create your first retention schedule to get started"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((schedule) => (
                  <tr
                    key={schedule.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400 mr-1.5">
                          {schedule.classificationNode.code}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {schedule.classificationNode.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums">
                      {schedule.activeYears}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums">
                      {schedule.inactiveYears}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                      {schedule.totalYears}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ACTION_BADGE[schedule.disposalAction]}`}
                      >
                        {ACTION_LABEL[schedule.disposalAction]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs max-w-xs truncate hidden lg:table-cell">
                      {schedule.legalBasis || (
                        <span className="text-gray-300 dark:text-gray-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Can anyOf={["records:update", "records:manage"]}>
                          <button
                            onClick={() => openEditModal(schedule)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
                            title="Edit"
                          >
                            <PencilIcon />
                          </button>
                        </Can>
                        <Can anyOf={["records:delete", "records:manage"]}>
                          <button
                            onClick={() => setDeleteTarget(schedule)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Delete"
                          >
                            <TrashIcon />
                          </button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ======== Create / Edit Modal ======== */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeFormModal}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
            {/* Modal header */}
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {editingSchedule ? "Edit Schedule" : "New Retention Schedule"}
              </h2>
              <button
                onClick={closeFormModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="p-6 space-y-5">
              {formError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertIcon />
                    <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>
                  </div>
                </div>
              )}

              {/* Classification node */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Classification Node <span className="text-red-500">*</span>
                </label>
                <ClassificationSelect
                  nodes={nodes}
                  value={formNodeId}
                  onChange={setFormNodeId}
                />
              </div>

              {/* Year inputs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Active Years <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formActiveYears}
                    onChange={(e) =>
                      setFormActiveYears(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    required
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Inactive Years <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formInactiveYears}
                    onChange={(e) =>
                      setFormInactiveYears(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    required
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Total Years
                  </label>
                  <div className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 text-sm text-gray-900 dark:text-gray-100 flex items-center font-semibold tabular-nums">
                    {computedTotal}
                  </div>
                </div>
              </div>

              {/* Disposal action */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Disposal Action <span className="text-red-500">*</span>
                </label>
                <select
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value as DisposalAction)}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                >
                  {DISPOSAL_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Legal basis */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Legal Basis
                  <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={formLegalBasis}
                  onChange={(e) => setFormLegalBasis(e.target.value)}
                  rows={3}
                  placeholder="e.g. Universities Act Cap 210B, KRA Tax Regulations..."
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
                />
              </div>

              {/* Footer buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={closeFormModal}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && <SpinnerIcon />}
                  {editingSchedule ? "Save Changes" : "Create Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======== Delete Confirmation Modal ======== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md animate-scale-in">
            <div className="p-6 space-y-4">
              {/* Warning icon */}
              <div className="flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
              </div>

              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Delete Retention Schedule
                </h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Are you sure you want to delete the retention schedule for{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {deleteTarget.classificationNode.code} - {deleteTarget.classificationNode.title}
                  </span>
                  ? This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting && <SpinnerIcon />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
