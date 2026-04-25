"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */

interface MemoUser {
  id: string;
  name: string;
  displayName: string;
  department?: string;
  jobTitle?: string;
}

interface TrailStep {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment: string | null;
  assignee: MemoUser | null;
  assignedAt: string | null;
  completedAt: string | null;
}

interface MemoRow {
  id: string;
  referenceNumber: string;
  memoReferenceNumber: string | null;
  subject: string;
  status: string;
  from: MemoUser;
  to: MemoUser;
  startedAt: string;
  completedAt: string | null;
  currentAssignee: MemoUser | null;
  trail: TrailStep[];
}

/* ---------- constants ---------- */

const TABS = [
  { key: "all", label: "All" },
  { key: "in-progress", label: "In Progress" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "returned", label: "Returned" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_RECOMMENDATION:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL:
    "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  APPROVED:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  SENT:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  RETURNED:
    "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  CANCELLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_RECOMMENDATION: "Pending Recommendation",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  SENT: "Sent",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isInProgress(status: string): boolean {
  return (
    status === "DRAFT" ||
    status === "PENDING_RECOMMENDATION" ||
    status === "PENDING_APPROVAL"
  );
}

/* ---------- component ---------- */

export default function TraceMyMemosPage() {
  const router = useRouter();

  const [memos, setMemos] = useState<MemoRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [trailMemo, setTrailMemo] = useState<MemoRow | null>(null);

  const fetchMemos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("initiatedByMe", "true");
      params.set("limit", "100");

      const res = await fetch(`/api/memos?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to fetch memos");
      }
      const data = await res.json();
      setMemos(data.memos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemos();
  }, [fetchMemos]);

  // Stats derived from all fetched memos (tab-independent)
  const stats = {
    total: memos.length,
    pending: memos.filter((m) => isInProgress(m.status)).length,
    approved: memos.filter((m) => m.status === "APPROVED" || m.status === "SENT")
      .length,
    rejected: memos.filter((m) => m.status === "REJECTED").length,
  };

  // Filter memos by active tab and free-text search (any parameter)
  const q = searchQuery.trim().toLowerCase();
  const filteredMemos = memos.filter((memo) => {
    switch (activeTab) {
      case "in-progress":
        if (!isInProgress(memo.status)) return false;
        break;
      case "approved":
        if (!(memo.status === "APPROVED" || memo.status === "SENT")) return false;
        break;
      case "rejected":
        if (memo.status !== "REJECTED") return false;
        break;
      case "returned":
        if (memo.status !== "RETURNED") return false;
        break;
    }
    if (!q) return true;

    const currentStep = memo.trail.find(
      (s) => s.status === "PENDING" && s.assignee
    );
    const haystack = [
      memo.memoReferenceNumber,
      memo.referenceNumber,
      memo.subject,
      memo.from.displayName,
      memo.from.name,
      memo.from.jobTitle,
      memo.from.department,
      memo.to.displayName,
      memo.to.name,
      memo.to.jobTitle,
      memo.to.department,
      currentStep?.assignee?.displayName,
      currentStep?.assignee?.name,
      currentStep?.stepName,
      STATUS_LABELS[memo.status] ?? memo.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Trace My Memos
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track the progress of memos you&rsquo;ve initiated
          </p>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-2">
          <StatPill
            label="Total"
            value={stats.total}
            tone="gray"
          />
          <StatPill
            label="Pending"
            value={stats.pending}
            tone="amber"
          />
          <StatPill
            label="Approved"
            value={stats.approved}
            tone="emerald"
          />
          <StatPill
            label="Rejected"
            value={stats.rejected}
            tone="red"
          />
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by ref, subject, sender, recipient, current assignee…"
          className="w-full h-10 pl-9 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-karu-green/30 focus:border-karu-green transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Clear"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-karu-green text-karu-green"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-red-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 animate-pulse"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-5 w-28 bg-gray-200 dark:bg-gray-700 rounded-full" />
              </div>
              <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
              <div className="space-y-2">
                <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
              <div className="mt-4 h-2 w-full bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      ) : filteredMemos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-16 flex flex-col items-center text-center animate-slide-up delay-100">
          <div className="w-16 h-16 rounded-full bg-karu-green/10 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-karu-green"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z"
              />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {activeTab === "all"
              ? "You haven't initiated any memos yet"
              : "No memos in this category"}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            {activeTab === "all"
              ? "Start a memo and it will appear here so you can track its progress through the approval chain."
              : "Try switching to a different filter to see your memos."}
          </p>
          {activeTab === "all" && (
            <Link
              href="/memos/new"
              className="inline-flex items-center gap-2 h-10 px-5 mt-5 rounded-lg bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2"
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
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Create New Memo
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: card list (no horizontal scroll). md+ = full table. */}
          <div className="md:hidden space-y-3 animate-slide-up delay-100">
            {filteredMemos.map((memo) => (
              <MemoCardItem
                key={memo.id}
                memo={memo}
                onViewTrail={() => setTrailMemo(memo)}
                onOpen={() => router.push(`/memos/${memo.id}`)}
              />
            ))}
          </div>
          <div className="hidden md:block rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden animate-slide-up delay-100">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Memo Ref</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subject</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">From</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">To</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Currently With</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden xl:table-cell">Trail</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Submitted</th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                  {filteredMemos.map((memo) => (
                    <MemoRowItem
                      key={memo.id}
                      memo={memo}
                      onViewTrail={() => setTrailMemo(memo)}
                      onOpen={() => router.push(`/memos/${memo.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Memo Trail Modal */}
      {trailMemo && (() => {
        const pendingSteps = trailMemo.trail.filter((s) => s.status === "PENDING");
        const lowestPending =
          pendingSteps.length > 0
            ? Math.min(...pendingSteps.map((s) => s.stepIndex))
            : Infinity;

        const dotClass = (step: TrailStep) => {
          if (step.status === "COMPLETED") {
            if (step.action === "REJECTED") return "bg-red-500 border-red-500";
            if (step.action === "RETURNED") return "bg-orange-400 border-orange-400";
            return "bg-karu-green border-karu-green";
          }
          if (step.status === "PENDING" && step.stepIndex === lowestPending)
            return "bg-amber-400 border-amber-400 animate-pulse";
          return "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600";
        };

        function getStepActionLabel(step: TrailStep): string | null {
          if (!step.action) return null;
          if (step.action === "REJECTED") return "Rejected";
          if (step.action === "RETURNED") return "Returned";
          if (step.action === "APPROVED") {
            if (step.stepName === "Final Approval") return "Approved";
            if (step.stepName === "Self-Review" || step.stepName.startsWith("Self-Review")) return "Submitted";
            return "Recommended";
          }
          return step.action;
        }

        const actionColor: Record<string, string> = {
          Approved: "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40",
          Recommended: "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40",
          Submitted: "text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-gray-800",
          Rejected: "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/40",
          Returned: "text-orange-700 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/40",
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setTrailMemo(null)}
          >
            <div
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                <div className="flex-1 min-w-0 pr-4">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                    Memo Trail
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                    {trailMemo.subject}
                  </p>
                  <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-1">
                    {trailMemo.referenceNumber}
                  </p>
                </div>
                <button
                  onClick={() => setTrailMemo(null)}
                  className="flex-shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Timeline */}
              <div className="px-5 py-4 overflow-y-auto max-h-[60vh]">
                <ol className="relative">
                  {trailMemo.trail.map((step, idx) => {
                    const isLast = idx === trailMemo.trail.length - 1;
                    const isCurrent = step.status === "PENDING" && step.stepIndex === lowestPending;
                    const isFuture = step.status === "PENDING" && step.stepIndex > lowestPending;
                    const isSkipped = step.status === "SKIPPED";
                    return (
                      <li key={step.id} className="flex gap-4">
                        {/* Spine */}
                        <div className="flex flex-col items-center">
                          <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 mt-1 ${dotClass(step)}`} />
                          {!isLast && (
                            <span className="w-0.5 flex-1 mt-1 mb-1 bg-gray-200 dark:bg-gray-700" />
                          )}
                        </div>
                        {/* Content */}
                        <div className={`pb-5 flex-1 min-w-0 ${isFuture || isSkipped ? "opacity-40" : ""}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {step.assignee?.displayName || step.assignee?.name || "—"}
                            </span>
                            {isCurrent && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-medium">
                                Current
                              </span>
                            )}
                            {(() => {
                              const label = getStepActionLabel(step);
                              return label ? (
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${actionColor[label] ?? ""}`}>
                                  {label}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{step.stepName}</p>
                          {step.assignee?.jobTitle && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">{step.assignee.jobTitle}</p>
                          )}
                          {step.comment && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                              &ldquo;{step.comment}&rdquo;
                            </p>
                          )}
                          {step.completedAt && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {formatDate(step.completedAt)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
                <button
                  onClick={() => { setTrailMemo(null); router.push(`/memos/${trailMemo.id}`); }}
                  className="text-sm text-karu-green hover:underline font-medium"
                >
                  Open memo →
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ---------- sub-components ---------- */

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "gray" | "amber" | "emerald" | "red";
}) {
  const styles: Record<typeof tone, string> = {
    gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    emerald:
      "bg-karu-green/10 text-karu-green dark:bg-karu-green/20 dark:text-emerald-400",
    red: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  };

  return (
    <div
      className={`inline-flex items-center gap-2 h-9 px-3 rounded-full text-xs font-medium ${styles[tone]}`}
    >
      <span className="opacity-80">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Mobile-only card representation of a memo. Shown below the `md` breakpoint
 * in place of the table — avoids forcing horizontal scrolling on phones.
 */
function MemoCardItem({
  memo,
  onViewTrail,
  onOpen,
}: {
  memo: MemoRow;
  onViewTrail: () => void;
  onOpen: () => void;
}) {
  const currentStep = memo.trail.find(
    (s) => s.status === "PENDING" && s.assignee
  );
  const fromName = memo.from.displayName || memo.from.name || "—";
  const toName = memo.to.displayName || memo.to.name || "—";

  return (
    <div
      onClick={onOpen}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 cursor-pointer hover:border-karu-green hover:shadow-sm transition-all space-y-3"
    >
      {/* Header: ref + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-mono font-medium text-[#dd9f42] uppercase tracking-wide">
            {memo.memoReferenceNumber ?? "—"}
          </span>
          <span className="block text-[10px] font-mono text-gray-400 dark:text-gray-500 mt-0.5">
            {memo.referenceNumber}
          </span>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap shrink-0 ${
            STATUS_STYLES[memo.status] ?? STATUS_STYLES.DRAFT
          }`}
        >
          {STATUS_LABELS[memo.status] ?? memo.status}
        </span>
      </div>

      {/* Subject */}
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">
        {memo.subject}
      </p>

      {/* People */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
            From
          </div>
          <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
            {fromName}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
            To
          </div>
          <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
            {toName}
          </div>
        </div>
        {currentStep && (
          <div className="col-span-2 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Currently with
            </div>
            <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
              {currentStep.assignee?.displayName || currentStep.assignee?.name}
              <span className="text-gray-400 dark:text-gray-500 font-normal">
                {" "}
                · {currentStep.stepName}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Mini progress trail */}
      <MiniProgress trail={memo.trail} />

      {/* Footer: date + actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          Submitted {formatDate(memo.startedAt)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewTrail();
            }}
            className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Trail
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-white bg-karu-green hover:bg-karu-green-dark transition-colors"
          >
            Open
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MemoRowItem({
  memo,
  onViewTrail,
  onOpen,
}: {
  memo: MemoRow;
  onViewTrail: () => void;
  onOpen: () => void;
}) {
  const currentStep = memo.trail.find(
    (s) => s.status === "PENDING" && s.assignee
  );

  return (
    <tr
      onClick={onOpen}
      className="group cursor-pointer hover:bg-karu-green/[0.03] dark:hover:bg-karu-green/[0.06] transition-colors"
    >
      {/* Memo Ref (document referenceNumber, e.g. KARU/ICT/9/56) */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex flex-col">
          <span className="text-xs font-mono font-medium text-[#dd9f42]">
            {memo.memoReferenceNumber ?? "—"}
          </span>
          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 mt-0.5">
            {memo.referenceNumber}
          </span>
        </div>
      </td>

      {/* Subject */}
      <td className="px-4 py-3 max-w-[320px]">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-karu-green transition-colors line-clamp-2">
          {memo.subject}
        </span>
      </td>

      {/* From */}
      <td className="px-4 py-3 hidden lg:table-cell max-w-[180px]">
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">
          {memo.from.displayName || memo.from.name || "—"}
        </span>
        {memo.from.jobTitle && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate block">
            {memo.from.jobTitle}
          </span>
        )}
      </td>

      {/* To */}
      <td className="px-4 py-3 max-w-[180px]">
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">
          {memo.to.displayName || memo.to.name || "—"}
        </span>
        {memo.to.jobTitle && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate block">
            {memo.to.jobTitle}
          </span>
        )}
      </td>

      {/* Currently with */}
      <td className="px-4 py-3 max-w-[200px]">
        {currentStep ? (
          <>
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">
              {currentStep.assignee?.displayName || currentStep.assignee?.name}
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate block">
              {currentStep.stepName}
            </span>
          </>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
            STATUS_STYLES[memo.status] ?? STATUS_STYLES.DRAFT
          }`}
        >
          {STATUS_LABELS[memo.status] ?? memo.status}
        </span>
      </td>

      {/* Trail (mini progress) */}
      <td className="px-4 py-3 hidden xl:table-cell min-w-[140px]">
        <MiniProgress trail={memo.trail} />
      </td>

      {/* Submitted */}
      <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell text-xs text-gray-500 dark:text-gray-400">
        {formatDate(memo.startedAt)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewTrail();
            }}
            className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Trail
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-white bg-karu-green hover:bg-karu-green-dark transition-colors"
          >
            Open
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

function MiniProgress({ trail }: { trail: TrailStep[] }) {
  if (trail.length === 0) return null;

  const pendingSteps = trail.filter((s) => s.status === "PENDING");
  const lowestPending =
    pendingSteps.length > 0
      ? Math.min(...pendingSteps.map((s) => s.stepIndex))
      : Infinity;

  function dotColor(step: TrailStep): string {
    if (step.status === "COMPLETED") {
      if (step.action === "REJECTED") return "bg-red-500";
      if (step.action === "RETURNED") return "bg-orange-400";
      return "bg-karu-green";
    }
    if (step.status === "PENDING" && step.stepIndex === lowestPending) {
      return "bg-amber-400 animate-pulse ring-2 ring-amber-200 dark:ring-amber-900";
    }
    return "bg-gray-200 dark:bg-gray-700";
  }

  function segmentColor(prevStep: TrailStep): string {
    if (prevStep.status === "COMPLETED") {
      if (prevStep.action === "REJECTED") return "bg-red-500";
      if (prevStep.action === "RETURNED") return "bg-orange-400";
      return "bg-karu-green";
    }
    return "bg-gray-200 dark:bg-gray-700";
  }

  return (
    <div className="flex items-center w-full">
      {trail.map((step, idx) => (
        <div key={step.id} className="flex items-center flex-1 last:flex-none">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor(step)}`}
            title={`${step.stepName} — ${step.status}`}
          />
          {idx < trail.length - 1 && (
            <span
              className={`flex-1 h-0.5 mx-1 rounded-full ${segmentColor(step)}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
