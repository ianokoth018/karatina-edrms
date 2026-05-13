"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

interface JobRow {
  id: string;
  name: string;
  sourcePath: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | string;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  department: string | null;
  documentType: string;
  tagsCsv: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdById: string;
  createdAt: string;
}

const STATUS_COLOURS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  RUNNING: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  COMPLETED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  FAILED: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  CANCELLED: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
};

export default function BulkImportPage() {
  const { can, ready } = usePermissions();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [department, setDepartment] = useState("");
  const [documentType, setDocumentType] = useState("OTHER");
  const [tagsCsv, setTagsCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bulk-import/jobs");
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && can("admin:manage")) load();
  }, [ready, can, load]);

  // Light polling so users see progress without refreshing.
  useEffect(() => {
    if (!ready || !can("admin:manage")) return;
    const hasActive = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");
    if (!hasActive) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [jobs, ready, can, load]);

  async function submit() {
    if (!name.trim() || !sourcePath.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bulk-import/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sourcePath: sourcePath.trim(),
          department: department.trim() || undefined,
          documentType: documentType.trim() || "OTHER",
          tagsCsv: tagsCsv.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to create job");
      }
      setCreating(false);
      setName("");
      setSourcePath("");
      setDepartment("");
      setDocumentType("OTHER");
      setTagsCsv("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage")) return <div className="p-6 text-red-600">Forbidden</div>;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Bulk Import</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Ingest documents from a server-side directory tree. Each file becomes a Document
            with encrypted bytes, tags, and a full audit trail. Duplicate content (matched by
            SHA-256) is skipped — re-running a job is safe.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="h-10 px-4 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] transition-colors shadow-md shadow-[#02773b]/20"
        >
          New import
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {creating && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New bulk-import job</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Registry migration — 2024 archive"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Source path <span className="text-gray-400">(absolute, server-side)</span>
              </label>
              <input
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="/srv/migration/legacy-dms/registry"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b] font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Department <span className="text-gray-400">(optional)</span>
              </label>
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="REGISTRY"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Document type
              </label>
              <input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="OTHER"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Tags <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="legacy, registry, 2024"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setCreating(false)}
              className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !name.trim() || !sourcePath.trim()}
              className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60"
            >
              {submitting ? "Queueing…" : "Queue import"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No bulk-import jobs yet. Queue one to start ingesting a directory tree.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Progress</th>
                <th className="px-4 py-3 text-right">Skipped</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {jobs.map((j) => {
                const denom = Math.max(j.totalFiles, j.processedFiles + j.skippedFiles + j.failedFiles, 1);
                const pct = Math.min(
                  100,
                  Math.round(((j.processedFiles + j.skippedFiles + j.failedFiles) / denom) * 100),
                );
                return (
                  <tr key={j.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/bulk-import/${j.id}`}
                        className="font-medium text-gray-900 dark:text-gray-100 hover:text-[#02773b]"
                      >
                        {j.name}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {j.department ?? "—"} · {j.documentType}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 max-w-[280px] truncate" title={j.sourcePath}>
                      {j.sourcePath}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                          STATUS_COLOURS[j.status] ?? STATUS_COLOURS.PENDING
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[180px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#02773b] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {j.processedFiles}/{j.totalFiles || "?"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{j.skippedFiles}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{j.failedFiles}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(j.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
