"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

type ComplianceFramework = "ISO15489" | "ISO27001" | "DPA-KE";
type ComplianceStatus =
  | "satisfied"
  | "partial"
  | "not_satisfied"
  | "unknown";

interface ResolvedClause {
  id: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  status: ComplianceStatus;
  count: number;
  detail: string;
  link?: string;
}

interface FrameworkResult {
  framework: ComplianceFramework;
  label: string;
  clauses: ResolvedClause[];
}

interface ApiResponse {
  generatedAt: string;
  frameworks: FrameworkResult[];
}

const TABS: { key: ComplianceFramework; label: string }[] = [
  { key: "ISO15489", label: "ISO 15489" },
  { key: "ISO27001", label: "ISO 27001" },
  { key: "DPA-KE", label: "Kenya DPA" },
];

const STATUS_STYLES: Record<
  ComplianceStatus,
  { pill: string; dot: string; label: string }
> = {
  satisfied: {
    pill: "bg-green-100 text-green-800 border-green-200",
    dot: "bg-green-500",
    label: "Satisfied",
  },
  partial: {
    pill: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
    label: "Partial",
  },
  not_satisfied: {
    pill: "bg-red-100 text-red-800 border-red-200",
    dot: "bg-red-500",
    label: "Not satisfied",
  },
  unknown: {
    pill: "bg-gray-100 text-gray-700 border-gray-200",
    dot: "bg-gray-400",
    label: "Unknown",
  },
};

export default function CompliancePage() {
  const { can, ready } = usePermissions();
  const [active, setActive] = useState<ComplianceFramework>("ISO15489");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/compliance")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse>;
      })
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Unknown error"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!ready || !can("admin:manage")) return;
    load();
  }, [ready, can, load]);

  const activeFramework = useMemo(
    () => data?.frameworks.find((f) => f.framework === active) ?? null,
    [data, active],
  );

  const totals = useMemo(() => {
    if (!data) return { satisfied: 0, total: 0 };
    let satisfied = 0;
    let total = 0;
    for (const f of data.frameworks) {
      for (const c of f.clauses) {
        total += 1;
        if (c.status === "satisfied") satisfied += 1;
      }
    }
    return { satisfied, total };
  }, [data]);

  if (!ready) return <div className="p-6 text-gray-500">Loading&hellip;</div>;
  if (!can("admin:manage"))
    return <div className="p-6 text-red-600">Forbidden</div>;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Compliance Evidence</h1>
          <p className="mt-1 text-sm text-gray-600">
            Snapshot of evidence currently available in the EDRMS, mapped to
            clauses of ISO 15489, ISO 27001, and the Kenya Data Protection
            Act, 2019. Use these summaries to track progress between formal
            certifications.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mb-4 rounded-md border border-gray-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-700">
          <span className="font-semibold">{totals.satisfied}</span> of{" "}
          <span className="font-semibold">{totals.total}</span> clauses
          satisfied across all frameworks
        </div>
        <div className="text-xs text-gray-500">
          Last refreshed:{" "}
          {data ? new Date(data.generatedAt).toLocaleString() : "—"}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-karu-green text-karu-green"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading && !data && <p className="text-gray-500">Loading&hellip;</p>}

      {activeFramework && (
        <FrameworkPanel framework={activeFramework} />
      )}

      <p className="mt-8 text-xs text-gray-500 italic">
        These dashboards are evidence summaries, not formal audit reports.
        Use them to track progress between formal certifications. Nothing
        here implies the system is certified against any standard.
      </p>
    </div>
  );
}

function FrameworkPanel({ framework }: { framework: FrameworkResult }) {
  const satisfied = framework.clauses.filter((c) => c.status === "satisfied").length;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {framework.label} —{" "}
          <span className="text-gray-700">
            {satisfied}/{framework.clauses.length} satisfied
          </span>
        </h2>
      </div>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
        {framework.clauses.map((c) => (
          <ClauseRow key={c.id} clause={c} />
        ))}
      </div>
    </section>
  );
}

function ClauseRow({ clause }: { clause: ResolvedClause }) {
  const style = STATUS_STYLES[clause.status];
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-4 px-4 py-3">
      <div className="pt-1">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.pill}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900">{clause.title}</p>
          <span className="text-[11px] font-mono text-gray-400">
            {clause.id}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{clause.description}</p>
        <p className="text-xs text-gray-700 mt-1">{clause.detail}</p>
      </div>
      <div className="text-right">
        <div className="text-lg font-mono text-gray-900">
          {clause.count.toLocaleString()}
        </div>
        {clause.link && (
          <Link
            href={clause.link}
            className="text-xs text-karu-green hover:underline"
          >
            View &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
