"use client";

import { useEffect, useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface AnalyticsResult {
  sinceDays: number;
  total: number;
  uniqueQueries: number;
  zeroResultRate: number;
  avgDurationMs: number;
  avgResultCount: number;
  topQueries: { query: string; count: number; avgResults: number }[];
  zeroResultTop: { query: string; count: number }[];
  recent: {
    query: string;
    resultCount: number;
    durationMs: number;
    occurredAt: string;
  }[];
}

export default function SearchAnalyticsPage() {
  const { can, ready } = usePermissions();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !can("admin:manage")) return;
    setLoading(true);
    fetch(`/api/admin/search-analytics?sinceDays=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AnalyticsResult>;
      })
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Unknown error")
      )
      .finally(() => setLoading(false));
  }, [days, ready, can]);

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage"))
    return <div className="p-6 text-red-600">Forbidden</div>;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Search analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            What people are searching for, what they're finding, and what
            they're not.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {data && (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total searches" value={data.total.toLocaleString()} />
            <Stat
              label="Unique queries"
              value={data.uniqueQueries.toLocaleString()}
            />
            <Stat
              label="Zero-result rate"
              value={`${Math.round(data.zeroResultRate * 100)}%`}
              warn={data.zeroResultRate > 0.2}
            />
            <Stat
              label="Avg duration"
              value={`${data.avgDurationMs} ms`}
              warn={data.avgDurationMs > 500}
            />
          </dl>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Top queries
            </h2>
            <Table
              columns={["Query", "Count", "Avg results"]}
              rows={data.topQueries.map((q) => [
                q.query,
                q.count.toLocaleString(),
                String(q.avgResults),
              ])}
              empty="No searches in this window."
            />
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Searches that returned nothing
            </h2>
            <p className="mb-2 text-xs text-gray-500">
              Candidates for content gaps, metadata-tagging improvements,
              or AI/semantic search.
            </p>
            <Table
              columns={["Query", "Times"]}
              rows={data.zeroResultTop.map((q) => [
                q.query,
                q.count.toLocaleString(),
              ])}
              empty="No zero-result searches — nice."
            />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Recent searches
            </h2>
            <Table
              columns={["When", "Query", "Results", "Duration"]}
              rows={data.recent.map((r) => [
                new Date(r.occurredAt).toLocaleString(),
                r.query,
                String(r.resultCount),
                `${r.durationMs} ms`,
              ])}
              empty="None."
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        warn
          ? "border-amber-300 bg-amber-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd
        className={`text-2xl font-mono ${
          warn ? "text-amber-700" : "text-gray-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-gray-500"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-4 text-center text-xs italic text-gray-400"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="px-3 py-1.5 text-xs text-gray-700"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
