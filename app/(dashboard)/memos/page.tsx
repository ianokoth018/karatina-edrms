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

interface MemoRow {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  from: MemoUser;
  to: MemoUser;
  startedAt: string;
  completedAt: string | null;
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
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
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
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
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
                  <td colSpan={6} className="px-4 py-12 text-center">
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
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-xs">
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
    </div>
  );
}
