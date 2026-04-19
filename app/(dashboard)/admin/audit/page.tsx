"use client";

import { useState, useEffect, useCallback } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface AuditUser {
  id: string;
  name: string;
  displayName: string;
  department: string | null;
  email: string;
}

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  user: AuditUser | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Filters {
  actions: string[];
  resourceTypes: string[];
}

export default function AuditTrailPage() {
  const { can } = usePermissions();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [filters, setFilters] = useState<Filters>({
    actions: [],
    resourceTypes: [],
  });
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filter state
  const [filterAction, setFilterAction] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const fetchAuditLogs = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "50",
        });
        if (filterAction) params.set("action", filterAction);
        if (filterResourceType) params.set("resourceType", filterResourceType);
        if (filterSearch) params.set("search", filterSearch);
        if (filterDateFrom) params.set("dateFrom", filterDateFrom);
        if (filterDateTo) params.set("dateTo", filterDateTo);

        const res = await fetch(`/api/admin/audit?${params}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries);
          setPagination(data.pagination);
          setFilters(data.filters);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [filterAction, filterResourceType, filterSearch, filterDateFrom, filterDateTo]
  );

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  function handleApplyFilters(e: React.FormEvent) {
    e.preventDefault();
    fetchAuditLogs(1);
  }

  function handleClearFilters() {
    setFilterAction("");
    setFilterResourceType("");
    setFilterSearch("");
    setFilterDateFrom("");
    setFilterDateTo("");
  }

  function toggleExpand(id: string) {
    setExpandedRow((prev) => (prev === id ? null : id));
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatActionLabel(action: string) {
    return action
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const hasPermission = can("admin:manage");

  if (!hasPermission) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to view the audit trail.
          </p>
        </div>
      </div>
    );
  }

  const hasActiveFilters =
    filterAction || filterResourceType || filterSearch || filterDateFrom || filterDateTo;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Audit Trail
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Complete log of all system actions and changes
        </p>
      </div>

      {/* Filter Bar */}
      <form
        onSubmit={handleApplyFilters}
        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {/* Search */}
          <div className="xl:col-span-2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Search
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
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
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search action, resource type, ID..."
                className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
            </div>
          </div>

          {/* Action dropdown */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Action
            </label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            >
              <option value="">All Actions</option>
              {filters.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Resource Type dropdown */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Resource Type
            </label>
            <select
              value={filterResourceType}
              onChange={(e) => setFilterResourceType(e.target.value)}
              className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            >
              <option value="">All Types</option>
              {filters.resourceTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              From
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              To
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-3 mt-3">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
          >
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
                d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
              />
            </svg>
            Apply Filters
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
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
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
              Clear
            </button>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
            {pagination.total.toLocaleString()} result{pagination.total !== 1 ? "s" : ""}
          </span>
        </div>
      </form>

      {/* Results Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Time
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  User
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Action
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Resource Type
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Resource ID
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-16 text-center"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <svg
                          className="w-6 h-6 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
                          />
                        </svg>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No audit entries found
                      </p>
                      <p className="text-gray-400 dark:text-gray-500 text-xs">
                        {hasActiveFilters
                          ? "Try adjusting your filters"
                          : "Audit entries will appear here as actions occur in the system"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const isExpanded = expandedRow === entry.id;
                  const hasMetadata =
                    entry.metadata &&
                    typeof entry.metadata === "object" &&
                    Object.keys(entry.metadata).length > 0;

                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                        {formatDate(entry.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        {entry.user ? (
                          <div>
                            <p className="text-gray-900 dark:text-gray-100 font-medium text-sm">
                              {entry.user.displayName}
                            </p>
                            <p className="text-gray-400 dark:text-gray-500 text-xs">
                              {entry.user.department ?? entry.user.email}
                            </p>
                          </div>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-xs italic">
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-karu-green-light dark:bg-karu-green/10 text-karu-green text-xs font-medium">
                          {formatActionLabel(entry.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 hidden md:table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium">
                          {entry.resourceType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono hidden lg:table-cell">
                        {entry.resourceId ? (
                          <span title={entry.resourceId}>
                            {entry.resourceId.length > 16
                              ? entry.resourceId.slice(0, 16) + "..."
                              : entry.resourceId}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">
                            --
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasMetadata ? (
                          <div>
                            <button
                              onClick={() => toggleExpand(entry.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
                              title={isExpanded ? "Collapse" : "Expand details"}
                            >
                              <svg
                                className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m19.5 8.25-7.5 7.5-7.5-7.5"
                                />
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="mt-2 text-left">
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                                  {JSON.stringify(entry.metadata, null, 2)}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600 text-xs">
                            --
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total.toLocaleString()}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => fetchAuditLogs(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              {/* Page number indicators */}
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
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
                    onClick={() => fetchAuditLogs(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      pageNum === pagination.page
                        ? "bg-karu-green text-white"
                        : "border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => fetchAuditLogs(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
