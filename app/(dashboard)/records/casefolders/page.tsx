"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Can } from "@/components/auth/can";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Casefolder {
  id: string;
  name: string;
  description: string | null;
  fields: unknown[];
  isActive: boolean;
  version: number;
  documentCount: number;
  createdAt: string;
  workflowTemplateId: string | null;
  workflowTemplateName: string | null;
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

function IconFolder({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function IconDocument({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconGrid({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
    </svg>
  );
}

function IconFolderEmpty({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={0.75} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Folder colour palette                                              */
/* ------------------------------------------------------------------ */

const FOLDER_COLORS = [
  { bg: "bg-[#02773b]/10", text: "text-[#02773b]" },
  { bg: "bg-[#dd9f42]/10", text: "text-[#dd9f42]" },
  { bg: "bg-sky-500/10", text: "text-sky-500" },
  { bg: "bg-violet-500/10", text: "text-violet-500" },
  { bg: "bg-rose-500/10", text: "text-rose-500" },
  { bg: "bg-teal-500/10", text: "text-teal-500" },
  { bg: "bg-orange-500/10", text: "text-orange-500" },
  { bg: "bg-indigo-500/10", text: "text-indigo-500" },
];

function folderColor(index: number) {
  return FOLDER_COLORS[index % FOLDER_COLORS.length];
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="h-7 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-64 bg-gray-200 dark:bg-gray-800 rounded-lg mt-2" />
        </div>
        <div className="h-10 w-48 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800"
          />
        ))}
      </div>

      {/* Search skeleton */}
      <div className="h-10 max-w-sm bg-gray-200 dark:bg-gray-800 rounded-xl" />

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-56 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800"
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function CasefoldersPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [casefolders, setCasefolders] = useState<Casefolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  /* ---------- fetch ---------- */

  const fetchCasefolders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/records/casefolders");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || `Failed to load casefolders (${res.status})`
        );
      }
      const data = await res.json();
      setCasefolders(data.casefolders ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load casefolders"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCasefolders();
  }, [fetchCasefolders]);

  /* ---------- derived ---------- */

  const filtered = casefolders.filter((cf) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      cf.name.toLowerCase().includes(q) ||
      (cf.description ?? "").toLowerCase().includes(q)
    );
  });

  const stats = {
    totalCategories: casefolders.length,
    totalDocuments: casefolders.reduce((sum, cf) => sum + cf.documentCount, 0),
    activeCategories: casefolders.filter((cf) => cf.isActive).length,
  };

  /* ---------- format date ---------- */

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  /* ---------- render ---------- */

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Casefolders
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Document categories and filing schemes
          </p>
        </div>
        <Can permission="forms:manage">
          <Link
            href="/forms/designer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            <IconPlus className="w-4 h-4" />
            Create New Casefolder
          </Link>
        </Can>
      </div>

      {/* ---- Error banner ---- */}
      {error && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-500 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              {error}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                fetchCasefolders();
              }}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ---- Stats row ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          {
            label: "Total Categories",
            value: stats.totalCategories,
            icon: <IconGrid className="w-5 h-5" />,
            color: "text-[#02773b] bg-[#02773b]/10",
          },
          {
            label: "Total Documents Filed",
            value: stats.totalDocuments,
            icon: <IconDocument className="w-5 h-5" />,
            color: "text-[#dd9f42] bg-[#dd9f42]/10",
          },
          {
            label: "Active Categories",
            value: stats.activeCategories,
            icon: <IconCheck className="w-5 h-5" />,
            color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 flex items-start gap-3"
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stat.color}`}
            >
              {stat.icon}
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stat.value.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {stat.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Search bar ---- */}
      <div className="relative max-w-sm">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search casefolders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors"
        />
      </div>

      {/* ---- Content ---- */}
      {casefolders.length === 0 && !error ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#02773b]/10 flex items-center justify-center mb-6">
            <IconFolderEmpty className="w-10 h-10 text-[#02773b]" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No casefolders defined yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            Create one using the Form Designer. Each form template defines a
            casefolder category with its metadata fields and filing scheme.
          </p>
          <Can permission="forms:manage">
            <Link
              href="/forms/designer"
              className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
            >
              <IconPlus className="w-4 h-4" />
              Open Form Designer
            </Link>
          </Can>
        </div>
      ) : filtered.length === 0 && casefolders.length > 0 ? (
        /* No search results */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <IconSearch className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            No casefolders match your search
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Try adjusting the search term.
          </p>
          <button
            onClick={() => setSearch("")}
            className="mt-4 text-sm font-medium text-[#02773b] hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        /* Cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((cf, index) => {
            const fieldCount = Array.isArray(cf.fields) ? cf.fields.length : 0;
            const color = folderColor(index);

            return (
              <button
                key={cf.id}
                type="button"
                onClick={() => router.push(`/records/casefolders/${cf.id}`)}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 hover:border-[#02773b]/30 dark:hover:border-[#02773b]/30 transition-all hover:shadow-md text-left flex flex-col cursor-pointer group"
              >
                {/* Card body */}
                <div className="p-5 flex-1 space-y-3">
                  {/* Folder icon + status */}
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color.bg} transition-transform group-hover:scale-105`}
                    >
                      <IconFolder className={`w-6 h-6 ${color.text}`} />
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
                        cf.isActive
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {cf.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* Name */}
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 group-hover:text-[#02773b] transition-colors">
                    {cf.name}
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                    {cf.description || "No description"}
                  </p>

                  {/* Meta chips */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
                      {fieldCount}{" "}
                      {fieldCount === 1 ? "metadata field" : "metadata fields"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#dd9f42] bg-[#dd9f42]/10 px-2 py-1 rounded-lg">
                      {cf.documentCount}{" "}
                      {cf.documentCount === 1 ? "document" : "documents"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg">
                      v{cf.version}
                    </span>
                    {cf.workflowTemplateName && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 px-2 py-1 rounded-lg">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                        </svg>
                        Workflow: {cf.workflowTemplateName}
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Created {formatDate(cf.createdAt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
