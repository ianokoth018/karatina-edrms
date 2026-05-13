"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

interface ItemRow {
  id: string;
  sourcePath: string;
  documentId: string | null;
  status: "PENDING" | "INGESTED" | "SKIPPED" | "FAILED" | string;
  error: string | null;
  bytes: string;
}

interface JobDetail {
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
  createdAt: string;
  items: ItemRow[];
}

const ITEM_STATUS_COLOURS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  INGESTED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  SKIPPED: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  FAILED: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Ingested", value: "INGESTED" },
  { label: "Skipped", value: "SKIPPED" },
  { label: "Failed", value: "FAILED" },
  { label: "Pending", value: "PENDING" },
];

function formatBytes(bytesStr: string): string {
  const n = Number(bytesStr);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function BulkImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { can, ready } = usePermissions();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bulk-import/jobs/${id}`);
      if (!res.ok) throw new Error("Failed to load job");
      const data = await res.json();
      setJob(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      params.set("limit", "200");
      const res = await fetch(`/api/admin/bulk-import/jobs/${id}/items?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      /* ignore */
    }
  }, [id, filter]);

  useEffect(() => {
    if (ready && can("admin:manage")) {
      load();
      loadItems();
    }
  }, [ready, can, load, loadItems]);

  // Poll while the job is still active so users see progress live.
  useEffect(() => {
    if (!ready || !can("admin:manage") || !job) return;
    if (job.status !== "PENDING" && job.status !== "RUNNING") return;
    const t = setInterval(() => {
      load();
      loadItems();
    }, 5000);
    return () => clearInterval(t);
  }, [job, ready, can, load, loadItems]);

  async function cancel() {
    if (!job) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/bulk-import/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to cancel");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage")) return <div className="p-6 text-red-600">Forbidden</div>;
  if (loading) return <div className="p-6 text-gray-500">Loading job…</div>;
  if (!job) return <div className="p-6 text-red-600">{error ?? "Not found"}</div>;

  const denom = Math.max(job.totalFiles, job.processedFiles + job.skippedFiles + job.failedFiles, 1);
  const pct = Math.min(
    100,
    Math.round(((job.processedFiles + job.skippedFiles + job.failedFiles) / denom) * 100),
  );
  const isActive = job.status === "PENDING" || job.status === "RUNNING";

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in max-w-6xl">
      <div>
        <Link
          href="/admin/bulk-import"
          className="text-xs text-gray-500 hover:text-[#02773b]"
        >
          ← All bulk imports
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{job.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono break-all">
            {job.sourcePath}
          </p>
          <div className="text-xs text-gray-500 mt-1">
            {job.department ?? "—"} · {job.documentType}
            {job.tagsCsv ? ` · tags: ${job.tagsCsv}` : ""}
          </div>
        </div>
        {isActive && (
          <button
            onClick={cancel}
            disabled={cancelling}
            className="h-9 px-4 rounded-lg border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-60"
          >
            {cancelling ? "Cancelling…" : "Cancel job"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {job.error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <span className="font-medium">Job error: </span>
          {job.error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500">Status</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{job.status}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500">Discovered</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{job.totalFiles}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500">Ingested</div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{job.processedFiles}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500">Skipped (dup)</div>
          <div className="mt-1 text-lg font-semibold text-amber-600">{job.skippedFiles}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="text-xs text-gray-500">Failed</div>
          <div className="mt-1 text-lg font-semibold text-red-600">{job.failedFiles}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#02773b] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-xs text-gray-500 grid grid-cols-2 gap-2 pt-2">
          <div>Started: {job.startedAt ? new Date(job.startedAt).toLocaleString() : "—"}</div>
          <div className="text-right">Finished: {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "—"}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            onClick={() => setFilter(f.value)}
            className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${
              filter === f.value
                ? "bg-[#02773b] text-white border-[#02773b]"
                : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No items {filter ? `with status ${filter}` : ""} yet.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Source path</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3 text-left">Document</th>
                <th className="px-4 py-3 text-left">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-[360px] truncate" title={it.sourcePath}>
                    {it.sourcePath}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                        ITEM_STATUS_COLOURS[it.status] ?? ITEM_STATUS_COLOURS.PENDING
                      }`}
                    >
                      {it.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-600 dark:text-gray-400">
                    {formatBytes(it.bytes)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {it.documentId ? (
                      <Link
                        href={`/documents/${it.documentId}`}
                        className="text-[#02773b] hover:underline font-mono"
                      >
                        {it.documentId.slice(0, 10)}…
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-red-600 dark:text-red-400 max-w-[280px] truncate" title={it.error ?? ""}>
                    {it.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
