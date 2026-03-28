"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface SearchResult {
  id: string;
  referenceNumber: string;
  title: string;
  description: string | null;
  documentType: string;
  department: string;
  status: string;
  createdAt: string;
  tags: { tag: string }[];
  createdBy: { id: string; name: string; displayName: string };
  classificationNode: { id: string; code: string; title: string } | null;
  _highlight: {
    title: string;
    description: string;
    referenceNumber: string;
  };
}

interface Facet {
  value: string;
  count: number;
}

interface Facets {
  departments: Facet[];
  types: Facet[];
  statuses: Facet[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [facets, setFacets] = useState<Facets>({
    departments: [],
    types: [],
    statuses: [],
  });
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Filters
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const doSearch = useCallback(
    async (page = 1) => {
      if (!query.trim()) return;

      setLoading(true);
      setHasSearched(true);

      try {
        const params = new URLSearchParams({
          q: query.trim(),
          page: String(page),
          limit: "20",
        });
        if (filterDepartment) params.set("department", filterDepartment);
        if (filterType) params.set("type", filterType);
        if (filterStatus) params.set("status", filterStatus);
        if (filterDateFrom) params.set("dateFrom", filterDateFrom);
        if (filterDateTo) params.set("dateTo", filterDateTo);

        const res = await fetch(`/api/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
          setFacets(data.facets);
          setPagination(data.pagination);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [query, filterDepartment, filterType, filterStatus, filterDateFrom, filterDateTo]
  );

  // Search on initial load if query param present
  useEffect(() => {
    if (initialQuery) {
      doSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    doSearch(1);
  }

  function getStatusColor(status: string) {
    const styles: Record<string, string> = {
      DRAFT:
        "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
      ACTIVE:
        "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
      CHECKED_OUT:
        "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
      ARCHIVED:
        "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
      PENDING_DISPOSAL:
        "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
      DISPOSED:
        "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
    };
    return styles[status] || styles.DRAFT;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Search input */}
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg
                className="w-5 h-5"
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents by title, reference, type, tags..."
              className="w-full h-14 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-12 pr-32 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all focus:border-karu-green focus:ring-4 focus:ring-karu-green/10 outline-none shadow-sm"
              autoFocus
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {/* Results area */}
      {hasSearched && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar facets */}
          <aside className="lg:w-64 flex-shrink-0 space-y-4">
            {/* Department filter */}
            {facets.departments.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Department
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setFilterDepartment("");
                      doSearch(1);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      !filterDepartment
                        ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    All
                  </button>
                  {facets.departments.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => {
                        setFilterDepartment(d.value);
                        setTimeout(() => doSearch(1), 0);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors flex justify-between ${
                        filterDepartment === d.value
                          ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span>{d.value}</span>
                      <span className="text-xs text-gray-400">{d.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Document Type filter */}
            {facets.types.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Document Type
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setFilterType("");
                      doSearch(1);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      !filterType
                        ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    All
                  </button>
                  {facets.types.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => {
                        setFilterType(t.value);
                        setTimeout(() => doSearch(1), 0);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors flex justify-between ${
                        filterType === t.value
                          ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span>{t.value.replace("_", " ")}</span>
                      <span className="text-xs text-gray-400">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Status filter */}
            {facets.statuses.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Status
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setFilterStatus("");
                      doSearch(1);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      !filterStatus
                        ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    All
                  </button>
                  {facets.statuses.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setFilterStatus(s.value);
                        setTimeout(() => doSearch(1), 0);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors flex justify-between ${
                        filterStatus === s.value
                          ? "bg-karu-green-light dark:bg-karu-green/10 text-karu-green font-medium"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span>{s.value.replace("_", " ")}</span>
                      <span className="text-xs text-gray-400">{s.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date range filter */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Date Range
              </h3>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    From
                  </label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => {
                      setFilterDateFrom(e.target.value);
                      setTimeout(() => doSearch(1), 0);
                    }}
                    className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    To
                  </label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => {
                      setFilterDateTo(e.target.value);
                      setTimeout(() => doSearch(1), 0);
                    }}
                    className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                  />
                </div>
              </div>
            </div>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {/* Results count */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {loading
                  ? "Searching..."
                  : `${pagination.total} result${pagination.total !== 1 ? "s" : ""} found`}
              </p>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse"
                  >
                    <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                    <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                    <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-12 text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 font-medium">
                  No documents match your search
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Try different keywords or adjust the filters
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-sm transition-shadow cursor-pointer"
                    onClick={() => router.push(`/documents/${doc.id}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3
                          className="font-semibold text-gray-900 dark:text-gray-100 mb-1"
                          dangerouslySetInnerHTML={{
                            __html: doc._highlight.title,
                          }}
                        />
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span
                            className="font-mono text-xs text-karu-green font-medium"
                            dangerouslySetInnerHTML={{
                              __html: doc._highlight.referenceNumber,
                            }}
                          />
                          <span className="text-gray-300 dark:text-gray-600">
                            |
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {doc.documentType.replace("_", " ")}
                          </span>
                          <span className="text-gray-300 dark:text-gray-600">
                            |
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {doc.department}
                          </span>
                        </div>
                        {doc._highlight.description && (
                          <p
                            className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: doc._highlight.description,
                            }}
                          />
                        )}
                        {doc.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {doc.tags.map((t) => (
                              <span
                                key={t.tag}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                              >
                                {t.tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium flex-shrink-0 ${getStatusColor(
                          doc.status
                        )}`}
                      >
                        {doc.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-xs text-gray-400 dark:text-gray-500">
                      <span>
                        By {doc.createdBy.displayName}
                      </span>
                      <span>
                        {new Date(doc.createdAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {doc.classificationNode && (
                        <span>
                          {doc.classificationNode.code} -{" "}
                          {doc.classificationNode.title}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => doSearch(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => doSearch(pagination.page + 1)}
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
      )}

      {/* Empty state when no search performed */}
      {!hasSearched && (
        <div className="max-w-3xl mx-auto text-center py-12">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={0.75}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Search Documents
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Search across all documents by title, reference number, type, description, and tags.
            Use the filters to narrow down results.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-karu-green rounded-full" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
