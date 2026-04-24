"use client";

import { use, useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const ACLPanel = lazy(() => import("@/components/casefolder/acl-panel"));

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CasefolderField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  [key: string]: unknown;
}

interface DocumentFile {
  id: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
}

interface CasefolderDocument {
  id: string;
  referenceNumber: string;
  title: string;
  status: string;
  department: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  files: DocumentFile[];
  createdBy: {
    name: string;
    displayName: string | null;
  };
  workflowStatus: string | null;
  workflowInstanceId: string | null;
}

interface Casefolder {
  id: string;
  name: string;
  description: string | null;
  fields: CasefolderField[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AggFolder {
  key: string;
  keyParts: Record<string, string>;
  label: string;
  documentCount: number;
  fileCount: number;
  latestDate: string;
  metadata: Record<string, unknown>;
}

interface ApiResponse {
  casefolder: Casefolder;
  view?: "documents" | "folders";
  hasAggregation?: boolean;
  aggregationFields?: { name: string; label: string }[];
  documents?: CasefolderDocument[];
  folders?: AggFolder[];
  folderKey?: string | null;
  pagination: Pagination;
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

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}


function IconDocumentEmpty({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={0.75} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconWarning({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconPaperclip({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

function IconLayoutGrid({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
    </svg>
  );
}

function IconList({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  DRAFT:
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  ARCHIVED:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  UNDER_REVIEW:
    "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  CLOSED:
    "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ??
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${style}`}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function truncate(str: string, len: number) {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}


/* ------------------------------------------------------------------ */
/*  Paginator                                                          */
/* ------------------------------------------------------------------ */

function Paginator({
  pagination,
  onPageChange,
}: {
  pagination: Pagination;
  onPageChange: (p: number) => void;
}) {
  const [jumpValue, setJumpValue] = useState("");
  const { page, totalPages, total, limit } = pagination;
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  function pages(): (number | "ellipsis")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const list: (number | "ellipsis")[] = [1];
    if (page > 3) list.push("ellipsis");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) list.push(i);
    if (page < totalPages - 2) list.push("ellipsis");
    list.push(totalPages);
    return list;
  }

  function handleJump(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const n = parseInt(jumpValue, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n);
    setJumpValue("");
  }

  const btnBase = "flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all duration-150 focus:outline-none";
  const btnIdle = "text-gray-500 dark:text-gray-400 hover:bg-[#02773b]/10 hover:text-[#02773b] dark:hover:text-[#02773b]";
  const btnDisabled = "opacity-30 cursor-not-allowed pointer-events-none";

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
      {/* Summary */}
      <p className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
        {from}–{to} <span className="text-gray-300 dark:text-gray-600">of</span> <span className="font-semibold text-gray-600 dark:text-gray-300">{total}</span>
      </p>

      {/* Page controls */}
      <div className="flex items-center gap-0.5 bg-gray-50 dark:bg-gray-800/60 rounded-2xl px-2 py-1.5 border border-gray-200 dark:border-gray-700">
        {/* First */}
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          className={`${btnBase} ${page <= 1 ? btnDisabled : btnIdle}`}
          title="First page"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
          </svg>
        </button>
        {/* Prev */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={`${btnBase} ${page <= 1 ? btnDisabled : btnIdle}`}
          title="Previous page"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Page pills */}
        {pages().map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} className="w-8 text-center text-xs text-gray-400 dark:text-gray-500 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`${btnBase} ${
                p === page
                  ? "bg-[#02773b] text-white shadow-md scale-105"
                  : btnIdle
              }`}
            >
              {p}
            </button>
          )
        )}

        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Next */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className={`${btnBase} ${page >= totalPages ? btnDisabled : btnIdle}`}
          title="Next page"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
        {/* Last */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          className={`${btnBase} ${page >= totalPages ? btnDisabled : btnIdle}`}
          title="Last page"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Jump to page */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">Go to</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={handleJump}
          placeholder={String(page)}
          className="w-12 h-8 text-center text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      {/* Breadcrumb */}
      <div className="h-4 w-72 bg-gray-200 dark:bg-gray-800 rounded-lg" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="h-8 w-56 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-80 bg-gray-200 dark:bg-gray-800 rounded-lg mt-2" />
        </div>
        <div className="h-10 w-44 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>

      {/* Search bar */}
      <div className="h-10 max-w-sm bg-gray-200 dark:bg-gray-800 rounded-xl" />

      {/* Table skeleton */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="h-12 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 border-b border-gray-100 dark:border-gray-800/50 flex items-center gap-4 px-4"
          >
            <div className="h-4 flex-1 bg-gray-200 dark:bg-gray-800 rounded" />
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
            <div className="h-4 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function CasefolderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.permissions?.includes("admin:manage") ?? false;
  const canManageCasefolder =
    isAdmin ||
    (session?.user?.permissions?.includes("records_casefolders:manage") ?? false);

  const [activeTab, setActiveTab] = useState<"documents" | "acl">("documents");
  const [casefolder, setCasefolder] = useState<Casefolder | null>(null);
  const [documents, setDocuments] = useState<CasefolderDocument[]>([]);
  const [folders, setFolders] = useState<AggFolder[]>([]);
  const [viewMode, setViewMode] = useState<"folders" | "documents">("folders");
  const [activeFolderKey, setActiveFolderKey] = useState<string | null>(null);
  const [hasAggregation, setHasAggregation] = useState(false);
  const [aggFields, setAggFields] = useState<{ name: string; label: string }[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [displayView, setDisplayView] = useState<"card" | "list">("card");

  const [activeFolderData, setActiveFolderData] = useState<AggFolder | null>(null);
  const prevFolderKeyRef = useRef<string | null>(null);

  /* ---------- fetch ---------- */

  const fetchData = useCallback(
    async (page: number, filters: Record<string, string>) => {
      try {
        setError(null);
        const qs = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        for (const [name, value] of Object.entries(filters)) {
          if (value.trim()) qs.set(`filter_${name}`, value.trim());
        }

        // If we have a folder selected, fetch its documents
        if (activeFolderKey) {
          qs.set("folderKey", activeFolderKey);
          qs.set("view", "documents");
        } else {
          // First load — try folders view
          qs.set("view", viewMode);
        }

        const res = await fetch(`/api/records/casefolders/${id}?${qs}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to load casefolder (${res.status})`
          );
        }

        const data: ApiResponse = await res.json();
        setCasefolder(data.casefolder);
        setHasAggregation(data.hasAggregation ?? (data.view === "folders"));
        if (data.aggregationFields) setAggFields(data.aggregationFields);

        if (data.view === "folders" && data.folders) {
          setFolders(data.folders);
          setDocuments([]);
          setViewMode("folders");
        } else {
          setDocuments(data.documents ?? []);
          setFolders([]);
          if (!activeFolderKey) setViewMode("documents");
        }
        setPagination(data.pagination);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load casefolder"
        );
      } finally {
        setLoading(false);
      }
    },
    [id, activeFolderKey, viewMode]
  );

  function openFolder(folder: AggFolder) {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`casefolder-${id}-scroll`, String(window.scrollY));
    }
    setActiveFolderKey(folder.key);
    setActiveFolderData(folder);
    setCurrentPage(1);
    setFieldFilters({});
    setActiveFilters({});
  }

  function closeFolder() {
    setActiveFolderKey(null);
    setActiveFolderData(null);
    setCurrentPage(1);
    setFieldFilters({});
    setActiveFilters({});
    setViewMode("folders");
  }

  useEffect(() => {
    setLoading(true);
    fetchData(currentPage, activeFilters);
  }, [fetchData, currentPage, activeFilters]);

  /* ---------- debounce field filters → activeFilters ---------- */

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      setActiveFilters(fieldFilters);
    }, 300);
    return () => clearTimeout(timer);
  }, [fieldFilters]);

  /* ---------- auto-redirect to first doc's detail page ---------- */
  /* When the user lands on a flat casefolder OR drills into a folder,
   * we send them straight to the first document's detail view rather
   * than showing a list + preview. Avoids the extra "Open" click. */

  useEffect(() => {
    if (activeTab !== "documents") return;
    if (loading) return;
    if (documents.length === 0) return;

    const showingDocuments = !hasAggregation || !!activeFolderKey;
    if (!showingDocuments) return;

    const firstDoc = documents[0];
    const qs = activeFolderKey
      ? `?folderKey=${encodeURIComponent(activeFolderKey)}`
      : "";
    router.replace(`/records/casefolders/${id}/${firstDoc.id}${qs}`);
  }, [activeTab, loading, documents, hasAggregation, activeFolderKey, id, router]);

  /* ---------- restore scroll when folder is closed ---------- */

  useEffect(() => {
    if (prevFolderKeyRef.current !== null && activeFolderKey === null) {
      const saved = sessionStorage.getItem(`casefolder-${id}-scroll`);
      if (saved) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: parseInt(saved, 10) });
          sessionStorage.removeItem(`casefolder-${id}-scroll`);
        });
      }
    }
    prevFolderKeyRef.current = activeFolderKey;
  }, [activeFolderKey, id]);

  /* ---------- derive visible columns ---------- */

  const visibleFields: CasefolderField[] = casefolder
    ? (Array.isArray(casefolder.fields) ? casefolder.fields : [])
        .filter((f) => !(f as { hidden?: boolean }).hidden)
        .slice(0, 5)
    : [];

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.trim());

  /* ---------- pagination helpers ---------- */

  function goToPage(p: number) {
    if (p < 1 || p > pagination.totalPages) return;
    setCurrentPage(p);
  }

  /* ---------- render ---------- */

  if (loading && !casefolder) return <LoadingSkeleton />;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ---- Breadcrumb ---- */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link
          href="/records"
          className="hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors"
        >
          Records
        </Link>
        <IconChevronRight className="w-3.5 h-3.5 shrink-0" />
        <Link
          href="/records/casefolders"
          className="hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors"
        >
          Casefolders
        </Link>
        <IconChevronRight className="w-3.5 h-3.5 shrink-0" />
        <span className="text-gray-900 dark:text-gray-100 font-medium truncate max-w-[200px]">
          {casefolder?.name ?? "..."}
        </span>
      </nav>

      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
            {casefolder?.name ?? "Casefolder"}
          </h1>
          {casefolder?.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
              {casefolder.description}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            {pagination.total} {pagination.total === 1 ? "document" : "documents"} filed
          </p>
        </div>
        <Link
          href={(() => {
            // Check if casefolder has a custom filing URL (e.g., /memos/new for Internal Memo)
            try {
              const descMeta = JSON.parse(casefolder?.description ?? "{}");
              if (descMeta.customFilingUrl) return descMeta.customFilingUrl;
            } catch { /* not JSON — use default */ }
            return `/records/casefolders/${id}/file`;
          })()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors shrink-0"
        >
          <IconPlus className="w-4 h-4" />
          File New Document
        </Link>
      </div>

      {/* ---- Tab bar ---- */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
        {(canManageCasefolder
          ? (["documents", "acl"] as const)
          : (["documents"] as const)
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-[#02773b] text-[#02773b]"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {tab === "documents" ? (
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                Documents
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                Access Control
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---- ACL Tab ---- */}
      {activeTab === "acl" && casefolder && canManageCasefolder && (
        <Suspense fallback={<div className="py-12 text-center text-gray-400">Loading access controls...</div>}>
          <ACLPanel
            casefolderName={casefolder.name}
            formTemplateId={id}
            userPermissions={{ canView: true, canCreate: true, canEdit: true, canDelete: true, canShare: true, canDownload: true, canPrint: true, canManageACL: canManageCasefolder }}
          />
        </Suspense>
      )}

      {/* ---- Documents Tab ---- */}
      {activeTab === "documents" && <>

      {/* ---- Error banner ---- */}
      {error && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
          <IconWarning className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              {error}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                fetchData(currentPage, activeFilters);
              }}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ---- Active folder breadcrumb + info card ---- */}
      {activeFolderKey && hasAggregation && (
        <div className="space-y-3">
          {/* Back breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={closeFolder}
              className="text-[#02773b] hover:underline font-medium flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              All Folders
            </button>
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {activeFolderKey.replace(/\|\|/g, " | ")}
            </span>
            <span className="text-gray-400">— {pagination.total} document{pagination.total !== 1 ? "s" : ""}</span>
          </div>

          {/* Folder metadata card */}
          {activeFolderData && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-[#dd9f42]/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Folder</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{activeFolderData.label}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {Object.entries(activeFolderData.keyParts).map(([fieldName, value]) => {
                  const aggField = aggFields.find((a) => a.name === fieldName);
                  return (
                    <div key={fieldName}>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{aggField?.label ?? fieldName}</div>
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{value}</div>
                    </div>
                  );
                })}
                <div className="ml-auto flex items-center gap-4 text-xs text-gray-400 self-end">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    {activeFolderData.documentCount} {activeFolderData.documentCount === 1 ? "doc" : "docs"}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconPaperclip className="w-3.5 h-3.5" />
                    {activeFolderData.fileCount} {activeFolderData.fileCount === 1 ? "file" : "files"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Field filter bar (only visible in folders grid view) ---- */}
      {visibleFields.length > 0 && viewMode === "folders" && !activeFolderKey && hasAggregation && (
        <div>
          {/* Header strip */}
          <div className="flex items-center justify-between px-1 py-2">
            <div className="flex items-center gap-2">
              <IconSearch className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                Filter
              </span>
              {hasActiveFilters && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#02773b]/10 text-[#02773b] text-[10px] font-semibold">
                  {Object.values(fieldFilters).filter((v) => v.trim()).length} active
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {hasActiveFilters && (
                <button
                  onClick={() => setFieldFilters({})}
                  className="text-[11px] font-medium text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear all
                </button>
              )}
              <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
              {/* View toggle */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setDisplayView("card")}
                  title="Card view"
                  className={`p-1.5 rounded-lg transition-colors ${
                    displayView === "card"
                      ? "bg-[#02773b] text-white shadow-sm"
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  <IconLayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDisplayView("list")}
                  title="List view"
                  className={`p-1.5 rounded-lg transition-colors ${
                    displayView === "list"
                      ? "bg-[#02773b] text-white shadow-sm"
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  <IconList className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Filter inputs */}
          <div className={`grid gap-2 ${
            visibleFields.length === 1 ? "grid-cols-1" :
            visibleFields.length === 2 ? "grid-cols-2" :
            visibleFields.length === 3 ? "grid-cols-3" :
            visibleFields.length === 4 ? "grid-cols-2 sm:grid-cols-4" :
            "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          }`}>
            {visibleFields.map((field) => {
              const val = fieldFilters[field.name] ?? "";
              const active = val.trim().length > 0;
              return (
                <div key={field.name} className="flex flex-col gap-1">
                  <label className={`text-[10px] font-semibold uppercase tracking-wider transition-colors ${active ? "text-[#02773b]" : "text-gray-400 dark:text-gray-500"}`}>
                    {field.label || field.name}
                  </label>
                  <div className={`flex items-center h-9 rounded-lg border bg-gray-50 dark:bg-gray-800 pl-2.5 pr-2 transition-all ${
                    active
                      ? "border-[#02773b] ring-2 ring-[#02773b]/20 bg-white dark:bg-gray-900"
                      : "border-gray-200 dark:border-gray-700 focus-within:border-[#02773b] focus-within:ring-2 focus-within:ring-[#02773b]/20 focus-within:bg-white dark:focus-within:bg-gray-900"
                  }`}>
                    <svg className={`w-3.5 h-3.5 shrink-0 mr-1.5 transition-colors ${active ? "text-[#02773b]" : "text-gray-400 dark:text-gray-500"}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                      type="text"
                      placeholder={field.label || field.name}
                      value={val}
                      onChange={(e) =>
                        setFieldFilters((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
                    />
                    {active && (
                      <button
                        type="button"
                        onClick={() => setFieldFilters((prev) => { const n = { ...prev }; delete n[field.name]; return n; })}
                        className="shrink-0 ml-1 w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/40 dark:hover:text-red-400 transition-colors flex items-center justify-center"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-1 py-1.5">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-gray-300 dark:border-gray-600 border-t-[#02773b] rounded-full animate-spin inline-block" />
                  Searching…
                </span>
              ) : hasActiveFilters ? (
                <>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{pagination.total}</span>
                  {" "}
                  {pagination.total === 1 ? "match" : "matches"} for{" "}
                  {Object.entries(fieldFilters)
                    .filter(([, v]) => v.trim())
                    .map(([name, val]) => (
                      <span key={name} className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md bg-[#02773b]/10 text-[#02773b] text-[10px] font-semibold">
                        {visibleFields.find((f) => f.name === name)?.label ?? name}: {val}
                      </span>
                    ))}
                </>
              ) : (
                <>
                  <span className="font-semibold text-gray-600 dark:text-gray-300">{pagination.total}</span>
                  {" "}{pagination.total === 1 ? "record" : "records"} total
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ---- Folders grid (aggregated view) ---- */}
      {viewMode === "folders" && !activeFolderKey && hasAggregation && (
        <>
          {folders.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-2xl bg-[#dd9f42]/10 flex items-center justify-center mb-6">
                <svg className="w-10 h-10 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {hasActiveFilters ? "No folders match your filters" : "No folders yet"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
                {hasActiveFilters
                  ? "Try adjusting or clearing the filters."
                  : "Documents will be grouped into folders once filed."}
              </p>
            </div>
          ) : displayView === "card" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {folders.map((folder) => (
                <button
                  key={folder.key}
                  onClick={() => openFolder(folder)}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 text-left hover:border-[#02773b]/40 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#dd9f42]/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      {Object.entries(folder.keyParts).map(([fieldName, value]) => {
                        const aggField = aggFields.find((a) => a.name === fieldName);
                        return (
                          <div key={fieldName} className="mb-1 last:mb-0">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">{aggField?.label ?? fieldName}</span>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-[#02773b] transition-colors">
                              {value}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {Object.keys(folder.metadata).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1">
                      {Object.entries(folder.metadata)
                        .filter(([k]) => !Object.keys(folder.keyParts).includes(k))
                        .filter(([k]) => {
                          const f = casefolder?.fields.find((ff) => ff.name === k);
                          return !(f as { hidden?: boolean } | undefined)?.hidden;
                        })
                        .slice(0, 3)
                        .map(([key, val]) => {
                          const field = casefolder?.fields.find((f) => f.name === key);
                          return (
                            <p key={key} className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              <span className="font-medium">{field?.label ?? key}:</span> {String(val)}
                            </p>
                          );
                        })}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                      </svg>
                      {folder.fileCount} {folder.fileCount !== 1 ? "attachments" : "attachment"}
                    </span>
                    <span>
                      {new Date(folder.latestDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* List view for folders */
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                    {visibleFields.map((field) => (
                      <th key={field.name} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                        {field.label || field.name}
                      </th>
                    ))}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Attachments</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Last Filed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                  {folders.map((folder) => (
                    <tr
                      key={folder.key}
                      onClick={() => openFolder(folder)}
                      className="hover:bg-[#02773b]/[0.03] dark:hover:bg-[#02773b]/[0.06] cursor-pointer transition-colors group"
                    >
                      {visibleFields.map((field, fieldIdx) => {
                        const raw =
                          folder.keyParts[field.name] ??
                          (folder.metadata[field.name] !== undefined
                            ? String(folder.metadata[field.name])
                            : undefined);
                        const value = raw ?? "—";
                        return (
                          <td key={field.name} className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {fieldIdx === 0 && (
                                <div className="w-7 h-7 rounded-lg bg-[#dd9f42]/10 flex items-center justify-center flex-shrink-0">
                                  <svg className="w-3.5 h-3.5 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                                  </svg>
                                </div>
                              )}
                              <span className={`text-sm truncate max-w-[200px] ${fieldIdx === 0 ? "font-medium text-gray-900 dark:text-gray-100 group-hover:text-[#02773b] transition-colors" : "text-gray-600 dark:text-gray-300"}`}>
                                {truncate(value, 32)}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                        {folder.fileCount}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">
                        {new Date(folder.latestDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Documents view (auto-redirects to first doc's detail page) ---- */}
      {(viewMode === "documents" || activeFolderKey || !hasAggregation) && (
        documents.length === 0 && !loading ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-2xl bg-[#02773b]/10 flex items-center justify-center mb-6">
              <IconDocumentEmpty className="w-10 h-10 text-[#02773b]" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {hasActiveFilters ? "No documents match your filters" : "No documents filed yet"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
              {hasActiveFilters
                ? "Try adjusting or clearing the filters."
                : "Get started by filing the first document into this casefolder."}
            </p>
            {hasActiveFilters ? (
              <button onClick={() => setFieldFilters({})} className="mt-4 text-sm font-medium text-[#02773b] hover:underline">
                Clear filters
              </button>
            ) : (
              <Link
                href={`/records/casefolders/${id}/file`}
                className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
              >
                <IconPlus className="w-4 h-4" />
                File New Document
              </Link>
            )}
          </div>
        ) : (
          /* Redirect in progress — show a subtle spinner */
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-[#02773b] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-400 dark:text-gray-500">Opening document…</span>
            </div>
          </div>
        )
      )}


      </>}{/* end documents tab */}
    </div>
  );
}
