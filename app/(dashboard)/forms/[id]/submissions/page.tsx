"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";

/* ---------- types ---------- */

interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  columns?: { name: string; label: string }[];
}

interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  version: number;
  submissionCount: number;
}

interface Submitter {
  name: string;
  displayName: string;
}

interface Submission {
  id: string;
  data: Record<string, unknown>;
  submittedById: string;
  submittedAt: string;
  submitter?: Submitter;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(value: unknown, max = 40): string {
  if (value === null || value === undefined) return "\u2014";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.length <= max) return str;
  return str.slice(0, max) + "\u2026";
}

function renderCellValue(value: unknown, field?: FormField): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (field?.type === "file" || field?.type === "attachment") {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && "name" in (value as Record<string, unknown>)) {
      return String((value as Record<string, unknown>).name);
    }
    return "File attached";
  }
  if (field?.type === "table" || Array.isArray(value)) {
    if (Array.isArray(value)) return `${value.length} row${value.length !== 1 ? "s" : ""}`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/* ---------- component ---------- */

export default function FormSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [form, setForm] = useState<FormTemplate | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoadingForm, setIsLoadingForm] = useState(true);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* fetch form template */
  useEffect(() => {
    async function loadForm() {
      setIsLoadingForm(true);
      try {
        const res = await fetch(`/api/forms/${id}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to load form template");
        }
        const data = await res.json();
        setForm({
          ...data,
          fields: Array.isArray(data.fields) ? data.fields : [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoadingForm(false);
      }
    }
    loadForm();
  }, [id]);

  /* fetch submissions */
  const fetchSubmissions = useCallback(
    async (page = 1) => {
      setIsLoadingSubmissions(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");

        const res = await fetch(
          `/api/forms/${id}/submissions?${params.toString()}`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch submissions");
        }
        const data = await res.json();
        setSubmissions(data.submissions);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoadingSubmissions(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchSubmissions(1);
  }, [fetchSubmissions]);

  /* fetch single submission detail */
  async function openSubmission(sub: Submission) {
    setDetailLoading(true);
    setSelectedSubmission(sub);
    try {
      const res = await fetch(`/api/forms/${id}/submissions/${sub.id}`);
      if (res.ok) {
        const full = await res.json();
        setSelectedSubmission(full);
      }
    } catch {
      // Fallback: use the row data we already have
    } finally {
      setDetailLoading(false);
    }
  }

  /* columns to display: first 5-6 fields from template */
  const displayFields = form?.fields.slice(0, 6) ?? [];
  const totalColumns = displayFields.length + 2; // +submitted by, +date

  const isLoading = isLoadingForm || isLoadingSubmissions;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/forms"
          className="text-gray-500 dark:text-gray-400 hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors"
        >
          Forms
        </Link>
        <svg
          className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 flex-shrink-0"
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
        {isLoadingForm ? (
          <span className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse inline-block" />
        ) : (
          <Link
            href={`/forms/${id}`}
            className="text-gray-500 dark:text-gray-400 hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors truncate max-w-[200px]"
          >
            {form?.name ?? "Form"}
          </Link>
        )}
        <svg
          className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 flex-shrink-0"
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
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          Submissions
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {isLoadingForm ? (
              <span className="inline-block h-7 w-56 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
            ) : (
              form?.name ?? "Form Submissions"
            )}
          </h1>
          <div className="flex items-center gap-3 mt-1.5">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isLoading ? (
                <span className="inline-block h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
              ) : (
                <>
                  {pagination.total} submission{pagination.total !== 1 ? "s" : ""}
                </>
              )}
            </p>
            {form?.isActive === false && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                Inactive
              </span>
            )}
          </div>
        </div>

        <button
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-[#dd9f42] hover:text-[#dd9f42] transition-colors whitespace-nowrap"
          onClick={() => {
            // Placeholder for CSV export
            alert("CSV export will be implemented soon.");
          }}
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
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
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

      {/* Submissions table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  #
                </th>
                {displayFields.map((field) => (
                  <th
                    key={field.name}
                    className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap max-w-[200px]"
                  >
                    {field.label || field.name}
                  </th>
                ))}
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Submitted By
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: totalColumns + 1 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${50 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : submissions.length === 0 ? (
                <tr>
                  <td
                    colSpan={totalColumns + 1}
                    className="px-4 py-16 text-center"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-[#02773b]/10 flex items-center justify-center">
                        <svg
                          className="w-7 h-7 text-[#02773b]"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                          />
                        </svg>
                      </div>
                      <div>
                        <p className="text-gray-900 dark:text-gray-100 font-medium">
                          No submissions yet
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Submissions will appear here once users fill out this
                          form.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                submissions.map((sub, idx) => (
                  <tr
                    key={sub.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => openSubmission(sub)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {(pagination.page - 1) * pagination.limit + idx + 1}
                    </td>
                    {displayFields.map((field) => (
                      <td
                        key={field.name}
                        className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[200px]"
                      >
                        <span className="block truncate">
                          {renderCellValue(sub.data[field.name], field)}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      <div className="truncate max-w-[160px]">
                        {sub.submitter
                          ? sub.submitter.displayName || sub.submitter.name
                          : sub.submittedById}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(sub.submittedAt)}
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
              of {pagination.total} submissions
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchSubmissions(pagination.page - 1)}
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
                  } else if (
                    pagination.page >=
                    pagination.totalPages - 2
                  ) {
                    pageNum = pagination.totalPages - 4 + i;
                  } else {
                    pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => fetchSubmissions(pageNum)}
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
                onClick={() => fetchSubmissions(pagination.page + 1)}
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

      {/* Submission detail modal */}
      {selectedSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedSubmission(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" />

          {/* Panel */}
          <div
            className="relative w-full max-w-2xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Submission Detail
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                  {selectedSubmission.id}
                </p>
              </div>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
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
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {detailLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-2 gap-4">
                      <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      <div
                        className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                        style={{ width: `${60 + Math.random() * 40}%` }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {(form?.fields ?? []).map((field) => {
                    const value = selectedSubmission.data[field.name];

                    /* table fields rendered as a mini-table */
                    if (
                      (field.type === "table" || field.columns) &&
                      Array.isArray(value)
                    ) {
                      const cols =
                        field.columns ??
                        (value.length > 0
                          ? Object.keys(
                              value[0] as Record<string, unknown>
                            ).map((k) => ({ name: k, label: k }))
                          : []);
                      return (
                        <div
                          key={field.name}
                          className="py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
                        >
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                            {field.label || field.name}
                          </p>
                          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/50">
                                  {cols.map((col) => (
                                    <th
                                      key={col.name}
                                      className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400"
                                    >
                                      {col.label || col.name}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {value.map(
                                  (
                                    row: Record<string, unknown>,
                                    ri: number
                                  ) => (
                                    <tr key={ri}>
                                      {cols.map((col) => (
                                        <td
                                          key={col.name}
                                          className="px-3 py-2 text-gray-700 dark:text-gray-300"
                                        >
                                          {truncate(row[col.name], 60)}
                                        </td>
                                      ))}
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    }

                    /* file fields */
                    if (
                      field.type === "file" ||
                      field.type === "attachment"
                    ) {
                      let fileName = "\u2014";
                      if (typeof value === "string" && value) {
                        fileName = value;
                      } else if (
                        value &&
                        typeof value === "object" &&
                        "name" in (value as Record<string, unknown>)
                      ) {
                        fileName = String(
                          (value as Record<string, unknown>).name
                        );
                      }
                      return (
                        <div
                          key={field.name}
                          className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-x-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
                        >
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {field.label || field.name}
                          </p>
                          <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                            <svg
                              className="w-4 h-4 text-[#dd9f42] flex-shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
                              />
                            </svg>
                            <span className="truncate">{fileName}</span>
                          </div>
                        </div>
                      );
                    }

                    /* default 2-column layout */
                    return (
                      <div
                        key={field.name}
                        className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-x-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
                      >
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {field.label || field.name}
                        </p>
                        <p className="text-sm text-gray-900 dark:text-gray-100 break-words">
                          {value === null ||
                          value === undefined ||
                          value === ""
                            ? "\u2014"
                            : typeof value === "boolean"
                              ? value
                                ? "Yes"
                                : "No"
                              : String(value)}
                        </p>
                      </div>
                    );
                  })}

                  {/* Metadata footer */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-x-4">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Submitted By
                      </p>
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        {selectedSubmission.submitter
                          ? selectedSubmission.submitter.displayName ||
                            selectedSubmission.submitter.name
                          : selectedSubmission.submittedById}
                      </p>
                    </div>
                    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-x-4">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Submitted At
                      </p>
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        {formatDateTime(selectedSubmission.submittedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={() => setSelectedSubmission(null)}
                className="h-9 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
