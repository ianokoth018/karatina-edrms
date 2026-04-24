"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface PendingTask {
  id: string;
  stepName: string;
  dueAt: string | null;
  assigneeId: string | null;
  poolId: string | null;
  escalationLevel: number;
  assignee: { id: string; name: string; displayName: string | null; email: string } | null;
}

interface MonitorInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  dueAt: string | null;
  overdueTaskCount: number;
  template: { id: string; name: string };
  initiatedBy: { id: string; name: string; displayName: string | null; email: string };
  document: { id: string; title: string; referenceNumber: string } | null;
  tasks: PendingTask[];
  _count: { tasks: number };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Template {
  id: string;
  name: string;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ================================================================== */
/*  Icons                                                              */
/* ================================================================== */

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconChevronDown({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function IconBolt({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

function IconUserSwitch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function IconXCircle({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

/* ================================================================== */
/*  Status badge                                                       */
/* ================================================================== */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    IN_PROGRESS: "bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400",
    COMPLETED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    REJECTED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
    CANCELLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? map.PENDING}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

/* ================================================================== */
/*  Admin action modals                                                */
/* ================================================================== */

function ForceAdvanceModal({
  task,
  onClose,
  onDone,
}: {
  task: PendingTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/tasks/${task.id}/force-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed");
        return;
      }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Force-advance task" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Force-complete <strong>{task.stepName}</strong> without waiting for the assignee.
        </p>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Action</label>
          <div className="flex gap-2">
            {(["APPROVED", "REJECTED"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  action === a
                    ? a === "APPROVED"
                      ? "bg-[#02773b] text-white border-[#02773b]"
                      : "bg-red-600 text-white border-red-600"
                    : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Admin comment</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Reason for force-advance..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 resize-none"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700">Cancel</button>
          <button
            onClick={submit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50"
          >
            {loading && <IconSpinner />}
            Force Advance
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ReassignModal({
  task,
  onClose,
  onDone,
}: {
  task: PendingTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string; displayName: string; email: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string; displayName: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setUsers([]); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=8`);
      if (res.ok) { const d = await res.json(); setUsers(d.users ?? []); }
    }, 300);
  }, [query]);

  async function submit() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/tasks/${task.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: selected.id }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed"); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Reassign task" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Reassign <strong>{task.stepName}</strong> to a different user.
        </p>
        {selected ? (
          <div className="flex items-center justify-between rounded-lg border border-[#02773b]/30 bg-[#02773b]/5 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selected.displayName || selected.name}</p>
              <p className="text-xs text-gray-500">{selected.email}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users..."
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 pl-9 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
              />
            </div>
            {users.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 max-h-40 overflow-y-auto">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelected(u); setUsers([]); setQuery(""); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{u.displayName || u.name}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700">Cancel</button>
          <button
            onClick={submit}
            disabled={loading || !selected}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50"
          >
            {loading && <IconSpinner />}
            Reassign
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CancelModal({
  instance,
  onClose,
  onDone,
}: {
  instance: MonitorInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${instance.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed"); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Cancel workflow" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Cancel <strong>{instance.referenceNumber}</strong> — {instance.subject}? This cannot be undone.
        </p>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason for cancellation..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400/40 resize-none"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700">Cancel</button>
          <button
            onClick={submit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            {loading && <IconSpinner />}
            Cancel Workflow
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InsertStepModal({
  instance,
  onClose,
  onDone,
}: {
  instance: MonitorInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stepName, setStepName] = useState("");
  const [stepIndex, setStepIndex] = useState<number>(instance._count.tasks);
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stepName.trim()) { setError("Step name is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${instance.id}/insert-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepName: stepName.trim(), stepIndex, assigneeEmail: assigneeEmail.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed"); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Insert step" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Insert an ad-hoc approval step into <strong>{instance.referenceNumber}</strong>.
        </p>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Step name *</label>
          <input
            value={stepName}
            onChange={(e) => setStepName(e.target.value)}
            placeholder="e.g. HOD Review"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Insert at position</label>
          <input
            type="number"
            min={0}
            value={stepIndex}
            onChange={(e) => setStepIndex(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Assignee email</label>
          <input
            value={assigneeEmail}
            onChange={(e) => setAssigneeEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700">Cancel</button>
          <button
            onClick={submit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50"
          >
            {loading && <IconSpinner />}
            Insert Step
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Row component                                                      */
/* ================================================================== */

function InstanceRow({
  inst,
  onRefresh,
}: {
  inst: MonitorInstance;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<
    | { type: "force"; task: PendingTask }
    | { type: "reassign"; task: PendingTask }
    | { type: "cancel" }
    | { type: "insert" }
    | null
  >(null);

  const isOverdue = inst.overdueTaskCount > 0;

  function closeModal() { setModal(null); }
  function doneAndRefresh() { setModal(null); onRefresh(); }

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors ${isOverdue ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
      >
        {/* Expand toggle */}
        <td className="pl-4 pr-2 py-3 w-8">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {expanded ? <IconChevronDown className="w-4 h-4" /> : <IconChevronRight className="w-4 h-4" />}
          </button>
        </td>

        {/* Reference */}
        <td className="px-3 py-3">
          <Link
            href={`/workflows/${inst.id}`}
            className="text-sm font-semibold text-[#02773b] dark:text-emerald-400 hover:underline"
          >
            {inst.referenceNumber}
          </Link>
        </td>

        {/* Subject + template */}
        <td className="px-3 py-3 max-w-[240px]">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inst.subject}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{inst.template.name}</p>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <StatusBadge status={inst.status} />
        </td>

        {/* Pending tasks */}
        <td className="px-3 py-3 text-center hidden sm:table-cell">
          <span className={`text-sm font-semibold ${inst.tasks.length > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>
            {inst.tasks.length}
          </span>
          {isOverdue && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {inst.overdueTaskCount} overdue
            </span>
          )}
        </td>

        {/* Initiator */}
        <td className="px-3 py-3 hidden md:table-cell">
          <p className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
            {inst.initiatedBy.displayName || inst.initiatedBy.name}
          </p>
        </td>

        {/* Started */}
        <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap hidden md:table-cell">
          {timeAgo(inst.startedAt)}
        </td>

        {/* Actions */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setModal({ type: "cancel" })}
              title="Cancel workflow"
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <IconXCircle />
            </button>
            <button
              onClick={() => setModal({ type: "insert" })}
              title="Insert step"
              className="p-1.5 rounded-lg text-gray-400 hover:text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
            >
              <IconPlus />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded task rows */}
      {expanded && inst.tasks.length > 0 && (
        <tr className="bg-gray-50/60 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-800">
          <td colSpan={8} className="px-10 py-3">
            <div className="space-y-2">
              {inst.tasks.map((t) => {
                const overdue = t.dueAt && new Date(t.dueAt) < new Date();
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-2.5 ${
                      overdue
                        ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{t.stepName}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t.poolId ? "Pool task" : t.assignee ? (t.assignee.displayName || t.assignee.name) : "Unassigned"}
                        {t.dueAt && (
                          <> &middot; Due {formatDateTime(t.dueAt)}</>
                        )}
                        {t.escalationLevel > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400">
                            L{t.escalationLevel} ESCALATED
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setModal({ type: "force", task: t })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] transition-colors"
                        title="Force advance"
                      >
                        <IconBolt className="w-3 h-3" /> Force
                      </button>
                      <button
                        onClick={() => setModal({ type: "reassign", task: t })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 transition-colors"
                        title="Reassign"
                      >
                        <IconUserSwitch className="w-3 h-3" /> Reassign
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}

      {/* Modals */}
      {modal?.type === "force" && (
        <ForceAdvanceModal task={modal.task} onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal?.type === "reassign" && (
        <ReassignModal task={modal.task} onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal?.type === "cancel" && (
        <CancelModal instance={inst} onClose={closeModal} onDone={doneAndRefresh} />
      )}
      {modal?.type === "insert" && (
        <InsertStepModal instance={inst} onClose={closeModal} onDone={doneAndRefresh} />
      )}
    </>
  );
}

/* ================================================================== */
/*  Main page                                                          */
/* ================================================================== */

export default function WorkflowMonitorPage() {
  const [instances, setInstances] = useState<MonitorInstance[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [page, setPage] = useState(1);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (templateFilter) params.set("templateId", templateFilter);

      const res = await fetch(`/api/workflows/monitor?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setInstances(data.instances ?? []);
      setPagination(data.pagination ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, statusFilter, templateFilter]);

  // Load templates for filter dropdown
  useEffect(() => {
    fetch("/api/workflows/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh setup
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchData(true), 30_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchData]);

  // KPIs
  const totalOverdue = instances.reduce((s, i) => s + i.overdueTaskCount, 0);
  const totalPending = instances.reduce((s, i) => s + i.tasks.length, 0);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Process Monitor</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Live view of active workflow instances</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-[#02773b] focus:ring-[#02773b]/40"
              />
              <span className="hidden sm:inline">Auto-refresh (30s)</span>
              <span className="sm:hidden">Auto (30s)</span>
            </label>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-60 shadow-sm transition-colors"
            >
              <IconRefresh className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Instances", value: pagination?.total ?? 0, color: "text-[#02773b] dark:text-emerald-400" },
            { label: "Pending Tasks", value: totalPending, color: "text-blue-600 dark:text-blue-400" },
            { label: "Overdue Tasks", value: totalOverdue, color: totalOverdue > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500" },
            { label: "Showing", value: instances.length, color: "text-gray-700 dark:text-gray-300" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{kpi.label}</p>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          <div className="relative flex-1 min-w-0">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by subject or reference..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b]"
            />
          </div>
          <div className="flex gap-3 flex-wrap sm:flex-nowrap">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              value={templateFilter}
              onChange={(e) => { setTemplateFilter(e.target.value); setPage(1); }}
              className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40"
            >
              <option value="">All templates</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
          {loading ? (
            <div className="animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-4 px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-4 flex-1 bg-gray-100 dark:bg-gray-900 rounded" />
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button onClick={() => fetchData()} className="mt-3 text-sm text-[#02773b] hover:underline">Retry</button>
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500 dark:text-gray-400">No instances found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className="pl-4 pr-2 py-3 w-8" />
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ref</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Subject / Template</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center hidden sm:table-cell">Pending</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden md:table-cell">Initiator</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden md:table-cell">Started</th>
                    <th className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => (
                    <InstanceRow key={inst.id} inst={inst} onRefresh={() => fetchData(true)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
