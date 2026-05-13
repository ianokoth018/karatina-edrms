"use client";

import { useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  ClassificationBadge,
  ALL_CLASSIFICATIONS,
} from "@/components/documents/classification-badge";
import type { SecurityClassification } from "@prisma/client";

interface OverviewResult {
  sinceDays: number;
  totals: {
    documents: number;
    documentsCreatedInWindow: number;
    workflowsInProgress: number;
    tasksOverdue: number;
    retentionDueSoon: number;
  };
  breakdowns: {
    byType: { key: string; count: number }[];
    byStatus: { key: string; count: number }[];
    byDepartment: { key: string; count: number }[];
    byClassification: { key: string; count: number }[];
  };
  topCreators: { userId: string; name: string; count: number }[];
}

const CLASSIFICATION_BAR_COLOR: Record<SecurityClassification, string> = {
  OPEN: "bg-gray-300",
  CONFIDENTIAL: "bg-blue-400",
  RESTRICTED: "bg-yellow-400",
  SECRET: "bg-orange-400",
  TOP_SECRET: "bg-red-400",
};

export default function ExecutiveReportsPage() {
  const { can, ready } = usePermissions();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !can("admin:manage")) return;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/reports/overview?sinceDays=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OverviewResult>;
      })
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Unknown error")
      )
      .finally(() => setLoading(false));
  }, [days, ready, can]);

  const csvHref = useMemo(() => {
    if (!data) return null;
    return buildCsv(data);
  }, [data]);

  if (!ready) return <div className="p-6 text-gray-500">Loading&hellip;</div>;
  if (!can("admin:manage"))
    return <div className="p-6 text-red-600">Forbidden</div>;

  function downloadCsv() {
    if (!csvHref || !data) return;
    const blob = new Blob([csvHref], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `executive-overview-${data.sinceDays}d-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Executive Overview</h1>
          <p className="mt-1 text-sm text-gray-600">
            A snapshot of document volume, workflow load, and contributor
            activity across the selected window.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading && <p className="text-gray-500">Loading&hellip;</p>}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              label="Total documents"
              value={data.totals.documents.toLocaleString()}
            />
            <Stat
              label={`Created in last ${data.sinceDays}d`}
              value={data.totals.documentsCreatedInWindow.toLocaleString()}
            />
            <Stat
              label="Workflows in progress"
              value={data.totals.workflowsInProgress.toLocaleString()}
            />
            <Stat
              label="Tasks overdue"
              value={data.totals.tasksOverdue.toLocaleString()}
              warn={data.totals.tasksOverdue > 0}
            />
            <Stat
              label="Retention due in 90d"
              value={data.totals.retentionDueSoon.toLocaleString()}
            />
          </dl>

          <Section title="Documents by type">
            <BarList
              rows={data.breakdowns.byType}
              empty="No documents in this window."
            />
          </Section>

          <Section title="By status">
            <BarList
              rows={data.breakdowns.byStatus}
              empty="No status data."
            />
          </Section>

          <Section title="By department">
            <BarList
              rows={data.breakdowns.byDepartment}
              empty="No department data."
            />
          </Section>

          <Section title="By security classification">
            <BarList
              rows={data.breakdowns.byClassification}
              empty="No classification data."
              renderLabel={(key) => {
                const level = ALL_CLASSIFICATIONS.includes(
                  key as SecurityClassification,
                )
                  ? (key as SecurityClassification)
                  : null;
                return level ? (
                  <ClassificationBadge level={level} size="sm" />
                ) : (
                  <span className="text-xs text-gray-700">{key}</span>
                );
              }}
              barColor={(key) => {
                const level = ALL_CLASSIFICATIONS.includes(
                  key as SecurityClassification,
                )
                  ? (key as SecurityClassification)
                  : null;
                return level
                  ? CLASSIFICATION_BAR_COLOR[level]
                  : "bg-karu-green";
              }}
            />
          </Section>

          <Section title="Top contributors (in window)">
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-gray-500 w-12">
                      #
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-gray-500">
                      Name
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-gray-500 w-24">
                      Documents
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.topCreators.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-xs italic text-gray-400"
                      >
                        No contributors in this window.
                      </td>
                    </tr>
                  ) : (
                    data.topCreators.map((c, i) => (
                      <tr key={c.userId}>
                        <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">
                          {i + 1}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-700">
                          {c.name}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-700 text-right font-mono">
                          {c.count.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-md bg-karu-green px-4 py-2 text-white text-sm font-medium hover:bg-karu-green-dark"
            >
              Download CSV
            </button>
          </div>
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
        warn ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BarList({
  rows,
  empty,
  renderLabel,
  barColor,
}: {
  rows: { key: string; count: number }[];
  empty: string;
  renderLabel?: (key: string) => React.ReactNode;
  barColor?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 px-3 py-4 text-center text-xs italic text-gray-400">
        {empty}
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
      {rows.map((r) => {
        const pct = Math.max(2, Math.round((r.count / max) * 100));
        const color = barColor ? barColor(r.key) : "bg-karu-green";
        return (
          <div
            key={r.key}
            className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 px-3 py-2"
          >
            <div className="truncate text-xs text-gray-700">
              {renderLabel ? renderLabel(r.key) : r.key}
            </div>
            <div className="h-2.5 rounded bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-right text-xs font-mono text-gray-700">
              {r.count.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(data: OverviewResult): string {
  const lines: string[] = [];
  lines.push(`Executive Overview`);
  lines.push(`Window (days),${data.sinceDays}`);
  lines.push(`Generated,${new Date().toISOString()}`);
  lines.push("");

  lines.push("Totals");
  lines.push("Metric,Value");
  lines.push(`Total documents,${data.totals.documents}`);
  lines.push(
    `Documents created in window,${data.totals.documentsCreatedInWindow}`,
  );
  lines.push(`Workflows in progress,${data.totals.workflowsInProgress}`);
  lines.push(`Tasks overdue,${data.totals.tasksOverdue}`);
  lines.push(`Retention due soon,${data.totals.retentionDueSoon}`);
  lines.push("");

  const breakdownSection = (
    title: string,
    rows: { key: string; count: number }[],
  ) => {
    lines.push(title);
    lines.push("Key,Count");
    for (const r of rows) {
      lines.push(`${csvEscape(r.key)},${r.count}`);
    }
    lines.push("");
  };

  breakdownSection("By type", data.breakdowns.byType);
  breakdownSection("By status", data.breakdowns.byStatus);
  breakdownSection("By department", data.breakdowns.byDepartment);
  breakdownSection("By classification", data.breakdowns.byClassification);

  lines.push("Top contributors");
  lines.push("Rank,Name,Count");
  data.topCreators.forEach((c, i) => {
    lines.push(`${i + 1},${csvEscape(c.name)},${c.count}`);
  });

  return lines.join("\n");
}
