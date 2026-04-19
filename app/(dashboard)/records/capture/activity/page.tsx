"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ================================================================
   Types
   ================================================================ */

interface CaptureProfile {
  id: string;
  name: string;
}

interface CaptureLog {
  id: string;
  profileId: string;
  profile: { name: string };
  fileName: string;
  filePath: string;
  fileSize: number | string | null;
  fileHash: string | null;
  status: LogStatus;
  documentId: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  processedAt: string | null;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type LogStatus = "PENDING" | "PROCESSING" | "CAPTURED" | "DUPLICATE" | "ERROR" | "SKIPPED";

/* ================================================================
   Constants
   ================================================================ */

const STATUS_OPTIONS: { value: LogStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "CAPTURED", label: "Captured" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "ERROR", label: "Error" },
  { value: "SKIPPED", label: "Skipped" },
];

const STATUS_BADGE: Record<LogStatus, { bg: string; text: string; dot: string }> = {
  CAPTURED: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  DUPLICATE: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  ERROR: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  PROCESSING: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  PENDING: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-600 dark:text-gray-400",
    dot: "bg-gray-400",
  },
  SKIPPED: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-500 dark:text-gray-500",
    dot: "bg-gray-400",
  },
};

const STATUS_LABEL: Record<LogStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  CAPTURED: "Captured",
  DUPLICATE: "Duplicate",
  ERROR: "Error",
  SKIPPED: "Skipped",
};

/* ================================================================
   Icons (inline SVGs)
   ================================================================ */

function IconChevronLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
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

function IconChevronUp({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function IconAlert({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconX({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconDocument({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  );
}

function IconExternalLink({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function IconEmpty({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function IconFolder({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function IconHash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.6 19.5m-2.4-19.5-3.6 19.5" />
    </svg>
  );
}

/* ================================================================
   Helpers
   ================================================================ */

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(raw: number | string | null | undefined): string {
  const bytes = Number(raw ?? 0);
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function getSearchParam(key: string): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get(key) ?? "";
}

/* ================================================================
   Main component
   ================================================================ */

export default function CaptureActivityPage() {
  /* -------- data state -------- */
  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [profiles, setProfiles] = useState<CaptureProfile[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 30,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* -------- filter state -------- */
  const [profileFilter, setProfileFilter] = useState(() => getSearchParam("profile"));
  const [statusFilter, setStatusFilter] = useState<LogStatus | "">("");

  /* -------- expanded row -------- */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* -------- auto-refresh -------- */
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ================================================================
     Data fetching
     ================================================================ */

  const fetchLogs = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "30");
        if (profileFilter) params.set("profileId", profileFilter);
        if (statusFilter) params.set("status", statusFilter);

        const res = await fetch(`/api/capture/logs?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch capture logs");
        }
        const data = await res.json();
        setLogs(data.logs ?? []);
        setPagination(
          data.pagination ?? { page: 1, limit: 30, total: 0, totalPages: 0 },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    },
    [profileFilter, statusFilter],
  );

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/capture/profiles");
      if (!res.ok) return;
      const data = await res.json();
      setProfiles(
        (data.profiles ?? []).map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        })),
      );
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  /* -------- auto-refresh timer -------- */
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs(pagination.page);
      }, 10000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, fetchLogs, pagination.page]);

  /* ================================================================
     Handlers
     ================================================================ */

  function handlePageChange(newPage: number) {
    fetchLogs(newPage);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function getProfileName(id: string): string {
    const p = profiles.find((x) => x.id === id);
    return p?.name ?? id.slice(0, 8);
  }

  /* ================================================================
     Render
     ================================================================ */

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* -------- Breadcrumb -------- */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <a
          href="/records"
          className="hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors"
        >
          Records
        </a>
        <span>/</span>
        <a
          href="/records/capture"
          className="hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors"
        >
          Auto Capture
        </a>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Activity</span>
      </nav>

      {/* -------- Header -------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Capture Activity</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Monitor document capture operations and review processing logs
          </p>
        </div>

        {/* Auto-refresh toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLogs(pagination.page)}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <IconRefresh className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                autoRefresh ? "bg-[#02773b]" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  autoRefresh ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">Auto-refresh</span>
          </label>
        </div>
      </div>

      {/* -------- Filter bar -------- */}
      <div className="flex flex-col sm:flex-row gap-3 animate-slide-up delay-100">
        {/* Profile filter */}
        <div className="relative">
          <select
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="appearance-none h-10 pl-3 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none min-w-[180px]"
          >
            <option value="">All Profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <IconChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LogStatus | "")}
            className="appearance-none h-10 pl-3 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none min-w-[160px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <IconChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Active filter indicators */}
        {(profileFilter || statusFilter) && (
          <button
            onClick={() => {
              setProfileFilter("");
              setStatusFilter("");
            }}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <IconX className="w-3.5 h-3.5" />
            Clear filters
          </button>
        )}

        {/* Result count */}
        {!isLoading && (
          <div className="flex items-center ml-auto text-sm text-gray-500 dark:text-gray-400">
            {pagination.total} log{pagination.total === 1 ? "" : "s"} found
            {autoRefresh && (
              <span className="ml-2 flex items-center gap-1 text-xs text-[#02773b] dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-[#02773b] dark:bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
        )}
      </div>

      {/* -------- Error banner -------- */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-sm">
          <IconAlert className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* -------- Loading skeleton -------- */}
      {isLoading && logs.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_1fr_1.5fr_0.6fr_0.8fr_0.8fr] gap-4 px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          {/* Skeleton rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_1.5fr_0.6fr_0.8fr_0.8fr] gap-4 px-5 py-4 border-b border-gray-50 dark:border-gray-800/50 animate-pulse"
            >
              <div className="h-3.5 w-28 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-3.5 w-24 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-3.5 w-36 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-3.5 w-14 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded-full" />
              <div className="h-3.5 w-12 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* -------- Empty state -------- */}
      {!isLoading && !error && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-slide-up">
          <IconEmpty className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            No capture activity found
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            {profileFilter || statusFilter
              ? "Try adjusting your filters to see more results."
              : "Capture activity will appear here once profiles start scanning for documents."}
          </p>
          {(profileFilter || statusFilter) && (
            <button
              onClick={() => {
                setProfileFilter("");
                setStatusFilter("");
              }}
              className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium text-[#02773b] dark:text-emerald-400 bg-[#02773b]/10 dark:bg-emerald-950/30 hover:bg-[#02773b]/20 dark:hover:bg-emerald-950/50 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* -------- Table -------- */}
      {!isLoading && logs.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-200">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[1fr_1fr_1.5fr_0.6fr_0.8fr_0.8fr] gap-4 px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Timestamp
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Profile
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              File Name
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Size
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Status
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Document
            </span>
          </div>

          {/* Table rows */}
          {logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const badge = STATUS_BADGE[log.status] ?? STATUS_BADGE.PENDING;
            const label = STATUS_LABEL[log.status] ?? log.status;

            return (
              <div key={log.id}>
                {/* Main row */}
                <button
                  onClick={() => toggleExpand(log.id)}
                  className={`w-full text-left grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.5fr_0.6fr_0.8fr_0.8fr] gap-2 sm:gap-4 px-5 py-3.5 border-b transition-colors ${
                    isExpanded
                      ? "bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800"
                      : "border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/30"
                  }`}
                >
                  {/* Timestamp */}
                  <div className="flex items-center gap-2">
                    <span className="sm:hidden text-xs font-medium text-gray-400">Time:</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDateShort(log.createdAt)}
                    </span>
                    {isExpanded ? (
                      <IconChevronUp className="w-3.5 h-3.5 text-gray-400 sm:hidden" />
                    ) : (
                      <IconChevronDown className="w-3.5 h-3.5 text-gray-400 sm:hidden" />
                    )}
                  </div>

                  {/* Profile */}
                  <div className="flex items-center">
                    <span className="sm:hidden text-xs font-medium text-gray-400 mr-2">Profile:</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {log.profile?.name ?? getProfileName(log.profileId)}
                    </span>
                  </div>

                  {/* File Name */}
                  <div className="flex items-center min-w-0">
                    <span className="sm:hidden text-xs font-medium text-gray-400 mr-2">File:</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">
                      {log.fileName}
                    </span>
                  </div>

                  {/* Size */}
                  <div className="flex items-center">
                    <span className="sm:hidden text-xs font-medium text-gray-400 mr-2">Size:</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatFileSize(log.fileSize)}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    <span className="sm:hidden text-xs font-medium text-gray-400 mr-2">Status:</span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                      {label}
                    </span>
                  </div>

                  {/* Document link */}
                  <div className="flex items-center">
                    {log.documentId ? (
                      <a
                        href={`/documents/${log.documentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-sm text-[#02773b] dark:text-emerald-400 hover:underline"
                      >
                        <IconDocument className="w-3.5 h-3.5" />
                        View
                        <IconExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-sm text-gray-300 dark:text-gray-600">--</span>
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 py-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800 animate-slide-up">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left column: file info */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                          File Details
                        </h4>

                        <div className="flex items-start gap-2">
                          <IconFolder className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Full Path</p>
                            <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                              {log.filePath}
                            </p>
                          </div>
                        </div>

                        {log.fileHash && (
                          <div className="flex items-start gap-2">
                            <IconHash className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500">File Hash</p>
                              <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                                {log.fileHash}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start gap-2">
                          <IconDocument className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">File Size</p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {formatFileSize(log.fileSize)} ({Number(log.fileSize ?? 0).toLocaleString()} bytes)
                            </p>
                          </div>
                        </div>

                        {log.processedAt && (
                          <div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Processed At</p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {formatDateTime(log.processedAt)}
                            </p>
                          </div>
                        )}

                        {log.createdAt && (
                          <div>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Created At</p>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {formatDateTime(log.createdAt)}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right column: metadata + errors */}
                      <div className="space-y-3">
                        {/* Error message */}
                        {log.errorMessage && (
                          <div>
                            <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider mb-2">
                              Error Details
                            </h4>
                            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40">
                              <p className="text-sm text-red-700 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
                                {log.errorMessage}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Extracted metadata */}
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                              Extracted Metadata
                            </h4>
                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                              {Object.entries(log.metadata).map(([key, value], idx) => (
                                <div
                                  key={key}
                                  className={`flex items-start gap-4 px-3 py-2 text-sm ${
                                    idx % 2 === 0
                                      ? "bg-gray-50 dark:bg-gray-800/50"
                                      : "bg-white dark:bg-gray-900"
                                  }`}
                                >
                                  <span className="font-medium text-gray-600 dark:text-gray-400 min-w-[120px] text-xs uppercase tracking-wide">
                                    {key}
                                  </span>
                                  <span className="text-gray-900 dark:text-gray-100 break-all">
                                    {typeof value === "object"
                                      ? JSON.stringify(value)
                                      : String(value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* No metadata / no error */}
                        {!log.errorMessage &&
                          (!log.metadata || Object.keys(log.metadata).length === 0) && (
                            <div className="flex items-center justify-center py-6 text-sm text-gray-400 dark:text-gray-500">
                              No additional details available
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* -------- Pagination -------- */}
      {!isLoading && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between animate-slide-up delay-300">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Page {pagination.page} of {pagination.totalPages}
            <span className="hidden sm:inline"> ({pagination.total} total)</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <IconChevronLeft />
            </button>

            {/* Page numbers */}
            {(() => {
              const pages: (number | "...")[] = [];
              const total = pagination.totalPages;
              const current = pagination.page;

              if (total <= 7) {
                for (let i = 1; i <= total; i++) pages.push(i);
              } else {
                pages.push(1);
                if (current > 3) pages.push("...");
                const start = Math.max(2, current - 1);
                const end = Math.min(total - 1, current + 1);
                for (let i = start; i <= end; i++) pages.push(i);
                if (current < total - 2) pages.push("...");
                pages.push(total);
              }

              return pages.map((p, idx) =>
                p === "..." ? (
                  <span
                    key={`dots-${idx}`}
                    className="w-9 h-9 flex items-center justify-center text-sm text-gray-400"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p as number)}
                    className={`w-9 h-9 rounded-xl text-sm font-medium transition-colors ${
                      p === current
                        ? "bg-[#02773b] text-white"
                        : "border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {p}
                  </button>
                ),
              );
            })()}

            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <IconChevronRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
