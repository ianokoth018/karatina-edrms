"use client";

import { use, useState, useEffect, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

function IconChevronLeft({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
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
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  /* ---------- fetch ---------- */

  const fetchData = useCallback(
    async (page: number, searchTerm: string) => {
      try {
        setError(null);
        const qs = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (searchTerm) qs.set("search", searchTerm);

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

  function openFolder(key: string) {
    setActiveFolderKey(key);
    setCurrentPage(1);
    setSearch("");
    setSearchInput("");
  }

  function closeFolder() {
    setActiveFolderKey(null);
    setCurrentPage(1);
    setSearch("");
    setSearchInput("");
    setViewMode("folders");
  }

  useEffect(() => {
    setLoading(true);
    fetchData(currentPage, search);
  }, [fetchData, currentPage, search]);

  /* ---------- search debounce ---------- */

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      setSearch(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* ---------- derive visible columns ---------- */

  const visibleFields: CasefolderField[] = casefolder
    ? (Array.isArray(casefolder.fields) ? casefolder.fields : []).slice(0, 5)
    : [];

  /* ---------- pagination helpers ---------- */

  function goToPage(p: number) {
    if (p < 1 || p > pagination.totalPages) return;
    setCurrentPage(p);
  }

  function pageNumbers(): (number | "ellipsis")[] {
    const total = pagination.totalPages;
    const current = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: (number | "ellipsis")[] = [1];
    if (current > 3) pages.push("ellipsis");
    for (
      let i = Math.max(2, current - 1);
      i <= Math.min(total - 1, current + 1);
      i++
    ) {
      pages.push(i);
    }
    if (current < total - 2) pages.push("ellipsis");
    pages.push(total);
    return pages;
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
          href={`/records/casefolders/${id}/file`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors shrink-0"
        >
          <IconPlus className="w-4 h-4" />
          File New Document
        </Link>
      </div>

      {/* ---- Tab bar ---- */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
        {(["documents", "acl"] as const).map((tab) => (
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
      {activeTab === "acl" && casefolder && (
        <Suspense fallback={<div className="py-12 text-center text-gray-400">Loading access controls...</div>}>
          <ACLPanel
            casefolderName={casefolder.name}
            formTemplateId={id}
            userPermissions={{ canView: true, canCreate: true, canEdit: true, canDelete: true, canShare: true, canDownload: true, canManageACL: true }}
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
                fetchData(currentPage, search);
              }}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ---- Active folder breadcrumb ---- */}
      {activeFolderKey && hasAggregation && (
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
      )}

      {/* ---- Search bar ---- */}
      <div className="relative max-w-sm">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder={activeFolderKey ? "Search in this folder..." : hasAggregation ? "Search folders..." : "Search documents..."}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors"
        />
      </div>

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
                {search ? "No folders match your search" : "No folders yet"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
                {search
                  ? "Try adjusting the search term."
                  : "Documents will be grouped into folders once filed."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {folders.map((folder) => (
                <button
                  key={folder.key}
                  onClick={() => openFolder(folder.key)}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 text-left hover:border-[#02773b]/40 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#dd9f42]/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Show each key part */}
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

                  {/* Casefolder-level metadata preview */}
                  {Object.keys(folder.metadata).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1">
                      {Object.entries(folder.metadata)
                        .filter(([k]) => !Object.keys(folder.keyParts).includes(k))
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

                  {/* Footer stats */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      {folder.documentCount} doc{folder.documentCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                      </svg>
                      {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {new Date(folder.latestDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- Documents table (flat view or inside a folder) ---- */}
      {(viewMode === "documents" || activeFolderKey || !hasAggregation) &&
        documents.length === 0 && !loading ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#02773b]/10 flex items-center justify-center mb-6">
            <IconDocumentEmpty className="w-10 h-10 text-[#02773b]" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {search ? "No documents match your search" : "No documents filed yet"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            {search
              ? "Try adjusting the search term or clear the filter."
              : "Get started by filing the first document into this casefolder."}
          </p>
          {search ? (
            <button
              onClick={() => {
                setSearchInput("");
                setSearch("");
              }}
              className="mt-4 text-sm font-medium text-[#02773b] hover:underline"
            >
              Clear search
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Loading overlay for subsequent fetches */}
          {loading && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 z-10 flex items-center justify-center rounded-2xl">
              <div className="w-6 h-6 border-2 border-[#02773b] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <div className="overflow-x-auto relative">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    Reference #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    Title
                  </th>
                  {visibleFields.map((field) => (
                    <th
                      key={field.name}
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell"
                    >
                      {field.label || field.name}
                    </th>
                  ))}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">
                    Workflow
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                    Created
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                    Files
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    onClick={() =>
                      router.push(`/records/casefolders/${id}/${doc.id}`)
                    }
                    className="hover:bg-[#02773b]/[0.03] dark:hover:bg-[#02773b]/[0.06] cursor-pointer transition-colors group"
                  >
                    {/* Reference # */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-xs font-mono font-medium text-[#dd9f42]">
                        {doc.referenceNumber}
                      </span>
                    </td>

                    {/* Title */}
                    <td className="px-4 py-3.5 max-w-[240px]">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-[#02773b] transition-colors">
                          {doc.title}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          {doc.createdBy.displayName || doc.createdBy.name}
                        </span>
                      </div>
                    </td>

                    {/* Dynamic metadata fields */}
                    {visibleFields.map((field) => {
                      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
                      const labels = (meta._fieldLabels ?? {}) as Record<string, string>;
                      // Multi-strategy: direct → label → camelCase
                      let raw = meta[field.name];
                      if (raw === undefined && field.label && labels[field.label] !== undefined) raw = labels[field.label];
                      if (raw === undefined) {
                        const camel = field.name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
                        raw = meta[camel];
                      }
                      const value = raw === null || raw === undefined ? "—" : String(raw);
                      return (
                        <td
                          key={field.name}
                          className="px-4 py-3.5 whitespace-nowrap text-gray-600 dark:text-gray-300 hidden lg:table-cell"
                          title={value !== "—" ? value : undefined}
                        >
                          {truncate(value, 28)}
                        </td>
                      );
                    })}

                    {/* Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <StatusBadge status={doc.status} />
                    </td>

                    {/* Workflow Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap hidden lg:table-cell">
                      {doc.workflowStatus ? (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
                            doc.workflowStatus === "COMPLETED"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : doc.workflowStatus === "REJECTED"
                                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                                : doc.workflowStatus === "IN_PROGRESS"
                                  ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          }`}
                        >
                          {doc.workflowStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">
                          --
                        </span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                      {formatDate(doc.createdAt)}
                    </td>

                    {/* Files count */}
                    <td className="px-4 py-3.5 whitespace-nowrap hidden md:table-cell">
                      {doc.files.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <IconPaperclip className="w-3.5 h-3.5" />
                          {doc.files.length}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">
                          -
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- Pagination ---- */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {(pagination.page - 1) * pagination.limit + 1}
                </span>
                {" - "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {Math.min(
                    pagination.page * pagination.limit,
                    pagination.total
                  )}
                </span>{" "}
                of{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {pagination.total}
                </span>
              </p>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <IconChevronLeft className="w-4 h-4" />
                </button>

                {pageNumbers().map((p, idx) =>
                  p === "ellipsis" ? (
                    <span
                      key={`e-${idx}`}
                      className="w-8 text-center text-xs text-gray-400"
                    >
                      ...
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => goToPage(p)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        p === pagination.page
                          ? "bg-[#02773b] text-white shadow-sm"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <IconChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      </>}{/* end documents tab */}
    </div>
  );
}
