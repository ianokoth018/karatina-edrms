"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Can } from "@/components/auth/can";

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
  subject: string;
  status: string;
  from: MemoUser;
  to: MemoUser;
  startedAt: string;
  completedAt: string | null;
  currentAssignee: MemoUser | null;
  awaitingClarification?: boolean;
  trail: TrailStep[];
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ---------- constants ---------- */

const TABS = [
  { key: "all", label: "All Memos" },
  { key: "drafts", label: "Drafts" },
  { key: "pending", label: "Pending My Action" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_RECOMMENDATION:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL:
    "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  APPROVED:
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
  REJECTED: "Rejected",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

/* ---------- component ---------- */

export default function MemosPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [memos, setMemos] = useState<MemoRow[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [trailMemo, setTrailMemo] = useState<MemoRow | null>(null);

  const fetchMemos = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");
        params.set("tab", activeTab);
        if (search) params.set("search", search);

        const res = await fetch(`/api/memos?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch memos");
        }
        const data = await res.json();
        setMemos(data.memos);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    },
    [activeTab, search]
  );

  useEffect(() => {
    fetchMemos(1);
  }, [fetchMemos]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchMemos(1);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Internal Memos
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Create, track, and manage internal memoranda
          </p>
        </div>

        <Can permission="memos:create">
          <Link
            href="/memos/new"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 whitespace-nowrap"
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
            New Memo
          </Link>
        </Can>
      </div>

      {/* Tabs */}
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

      {/* Search */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 animate-slide-up delay-100">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by subject or reference number..."
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
          >
            Search
          </button>
        </form>
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

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Reference #
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Subject
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  From
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  To
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  With
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${50 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : memos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <svg
                        className="w-12 h-12 text-gray-300 dark:text-gray-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z"
                        />
                      </svg>
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No memos found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {search
                          ? "Try adjusting your search"
                          : "Create your first memo to get started"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                memos.map((memo) => (
                  <tr
                    key={memo.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/memos/${memo.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {memo.referenceNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100 break-words min-w-[200px]">
                        {memo.subject}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      <div className="truncate max-w-[150px]">
                        {memo.from.displayName || memo.from.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      <div className="truncate max-w-[150px]">
                        {memo.to.displayName || memo.to.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_STYLES[memo.status] ?? STATUS_STYLES.DRAFT
                        }`}
                      >
                        {STATUS_LABELS[memo.status] ?? memo.status}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => { e.stopPropagation(); setTrailMemo(memo); }}
                    >
                      {memo.currentAssignee ? (
                        <div>
                          <button className="flex items-center gap-1.5 group">
                            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                              memo.awaitingClarification
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-karu-green/10 text-karu-green"
                            }`}>
                              {(memo.currentAssignee.displayName || memo.currentAssignee.name).charAt(0).toUpperCase()}
                            </span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-karu-green break-words transition-colors">
                              {memo.currentAssignee.displayName || memo.currentAssignee.name}
                            </span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-karu-green flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                            </svg>
                          </button>
                          {memo.awaitingClarification && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                              </svg>
                              Awaiting clarification
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(memo.startedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1}
              {" "}&ndash;{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total} memos
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchMemos(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                    d="M15.75 19.5 8.25 12l7.5-7.5"
                  />
                </svg>
              </button>

              {Array.from(
                { length: Math.min(pagination.totalPages, 5) },
                (_, i) => {
                  let pageNum: number;
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1;
                  } else if (pagination.page >= pagination.totalPages - 2) {
                    pageNum = pagination.totalPages - 4 + i;
                  } else {
                    pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => fetchMemos(pageNum)}
                      className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                        pageNum === pagination.page
                          ? "bg-karu-green text-white"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
              )}

              <button
                onClick={() => fetchMemos(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
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
