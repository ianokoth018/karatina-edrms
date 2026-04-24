"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/* --------------------------------- types ---------------------------------- */

type Scope = "institutional" | "directorate" | "departmental" | "individual";

interface Kpis {
  totalMemos: number;
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  avgTurnaroundHours: number | null;
  approvalRate: number | null;
}

interface StatusBreakdownRow {
  status: string;
  count: number;
}

interface TimePoint {
  date: string;
  count: number;
}

interface DepartmentRow {
  department: string;
  count: number;
}

interface InitiatorRow {
  key: string;
  name: string;
  count: number;
}

interface RecommenderRow {
  userId: string;
  name: string;
  completed: number;
  avgHours: number | null;
}

interface RecentRow {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  startedAt: string;
  currentAssignee: { id: string; name: string } | null;
}

interface AnalyticsPayload {
  scope: Scope;
  scopeLabel: string;
  department?: string | null;
  directorate?: string | null;
  kpis: Kpis;
  statusBreakdown: StatusBreakdownRow[];
  memosOverTime: TimePoint[];
  byDepartment?: DepartmentRow[];
  topInitiators?: InitiatorRow[];
  topInitiatorsGroupBy?: "directorate" | "department" | "user";
  topRecommenders?: RecommenderRow[];
  recentActivity: RecentRow[];
}

/* ---------------------------- status styling ------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#9ca3af",
  PENDING_RECOMMENDATION: "#f59e0b",
  PENDING_APPROVAL: "#3b82f6",
  APPROVED: "#10b981",
  SENT: "#10b981",
  REJECTED: "#ef4444",
  RETURNED: "#f97316",
  CANCELLED: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_RECOMMENDATION: "Pending Recommendation",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  SENT: "Sent",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_RECOMMENDATION:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL:
    "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  APPROVED:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  SENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  RETURNED:
    "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  CANCELLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

/* ------------------------------ formatters -------------------------------- */

function fmtHoursToDays(hours: number | null): string {
  if (hours === null || Number.isNaN(hours)) return "N/A";
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function fmtPercent(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* --------------------------------- icons ---------------------------------- */

const IconDoc = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>
);

const IconClock = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const IconCheck = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

const IconHourglass = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25a4.5 4.5 0 0 0 1.318 3.182L12 12l3.932-3.568A4.5 4.5 0 0 0 17.25 5.25V3M6.75 21v-2.25a4.5 4.5 0 0 1 1.318-3.182L12 12l3.932 3.568A4.5 4.5 0 0 1 17.25 18.75V21M5.25 3h13.5M5.25 21h13.5" />
  </svg>
);

/* ------------------------------ skeletons --------------------------------- */

function KpiSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-7 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-2.5 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      className="bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse w-full"
      style={{ height }}
    />
  );
}

/* ----------------------------- sub-components ----------------------------- */

function ScopeBadge({ scope }: { scope: Scope }) {
  const styles: Record<Scope, string> = {
    institutional:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900",
    directorate:
      "bg-karu-green-light text-karu-green dark:bg-karu-green/10 dark:text-emerald-400 ring-1 ring-karu-green/20",
    departmental:
      "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-900",
    individual:
      "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300 ring-1 ring-purple-200 dark:ring-purple-900",
  };
  const labels: Record<Scope, string> = {
    institutional: "Institution-wide view",
    directorate: "Directorate view",
    departmental: "Department view",
    individual: "Personal view",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${styles[scope]}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[scope]}
    </span>
  );
}

function KpiCard({
  label,
  value,
  subtext,
  icon,
  iconBg,
  iconColor,
  delayMs,
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  delayMs: number;
}) {
  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md transition-shadow animate-slide-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
          {subtext && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {subtext}
            </p>
          )}
        </div>
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  className = "",
  delayMs = 0,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-slide-up ${className}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function RankedList<T extends { name: string }>({
  items,
  value,
  max,
  emptyLabel,
}: {
  items: T[];
  value: (item: T) => number;
  max: number;
  emptyLabel: string;
}) {
  if (!items || items.length === 0) {
    return (
      <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const v = value(item);
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div
            key={i}
            className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
          >
            <div className="w-8 h-8 shrink-0 rounded-full bg-karu-green-light dark:bg-karu-green/10 text-karu-green flex items-center justify-center text-xs font-semibold">
              {initials(item.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {item.name}
                </span>
                <span className="text-sm font-semibold text-karu-green tabular-nums">
                  {v}
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-karu-green rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DepartmentList({ items }: { items: DepartmentRow[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
        No department data
      </div>
    );
  }
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="space-y-2">
      {items.slice(0, 8).map((row, i) => {
        const pct = max > 0 ? (row.count / max) * 100 : 0;
        return (
          <div
            key={i}
            className="group px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
          >
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {row.department}
              </span>
              <span className="text-sm font-semibold text-karu-green tabular-nums">
                {row.count}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-karu-green to-emerald-400 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalDonut({ rate, approved, total }: { rate: number | null; approved: number; total: number }) {
  const pct = rate === null ? 0 : Math.round(rate * 100);
  const data = [
    { name: "Approved", value: rate === null ? 0 : rate },
    { name: "Rest", value: rate === null ? 1 : 1 - rate },
  ];
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-48 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              innerRadius={65}
              outerRadius={90}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
            >
              <Cell fill="#02773b" />
              <Cell fill="#e5e7eb" className="dark:opacity-20" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            {rate === null ? "—" : `${pct}%`}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            approval rate
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-4 text-center">
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {approved}
        </span>{" "}
        of{" "}
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {total}
        </span>{" "}
        memos approved
      </p>
    </div>
  );
}

/* ------------------------------ main page --------------------------------- */

export default function MemoAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setIsLoading(true);
        const res = await fetch("/api/memos/analytics", { cache: "no-store" });
        if (!res.ok) {
          const msg =
            res.status === 401
              ? "You must sign in to view analytics."
              : "Failed to load analytics";
          throw new Error(msg);
        }
        const payload = (await res.json()) as AnalyticsPayload;
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const subtitle = useMemo(() => {
    if (!data) return "Loading insights…";
    if (data.scope === "institutional")
      return "Insights across the entire institution";
    if (data.scope === "directorate") return "Insights across the entire directorate";
    if (data.scope === "departmental")
      return `Insights across ${data.department ?? "your"} department`;
    return "Your memo activity";
  }, [data]);

  const statusChartData = useMemo(() => {
    if (!data) return [];
    return data.statusBreakdown
      .filter((s) => s.count > 0)
      .map((s) => ({
        name: STATUS_LABELS[s.status] ?? s.status,
        status: s.status,
        value: s.count,
      }));
  }, [data]);

  const timeChartData = useMemo(() => {
    if (!data) return [];
    return data.memosOverTime.map((p) => ({
      date: p.date,
      label: fmtShortDate(p.date),
      count: p.count,
    }));
  }, [data]);

  /* ------- error ------- */
  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-6 text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  /* ------- loading ------- */
  if (isLoading || !data) {
    return (
      <div className="p-4 sm:p-4 sm:p-6 space-y-6 animate-fade-in">
        <div>
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-96 bg-gray-200 dark:bg-gray-700 rounded mt-3 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <KpiSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
            <ChartSkeleton />
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
            <ChartSkeleton />
          </div>
        </div>
      </div>
    );
  }

  /* ------- empty ------- */
  const isEmpty = data.kpis.totalMemos === 0;

  return (
    <div className="p-4 sm:p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              Memo Analytics
            </h1>
            <ScopeBadge scope={data.scope} />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {subtitle}
          </p>
        </div>
        <Link
          href="/memos"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-karu-green border border-karu-green/30 hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back to Memos
        </Link>
      </div>

      {isEmpty ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-12 text-center animate-slide-up">
          <div className="w-16 h-16 rounded-2xl bg-karu-green-light dark:bg-karu-green/10 text-karu-green flex items-center justify-center mx-auto mb-4">
            {IconDoc}
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No memo data yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
            Analytics will appear here as soon as memos are initiated in your
            scope. Create your first memo to get started.
          </p>
          <Link
            href="/memos/new"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create a new memo
          </Link>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Memos"
              value={data.kpis.totalMemos.toLocaleString()}
              subtext={`${data.kpis.returned} returned`}
              icon={IconDoc}
              iconBg="bg-karu-green-light dark:bg-karu-green/10"
              iconColor="text-karu-green"
              delayMs={0}
            />
            <KpiCard
              label="Pending"
              value={data.kpis.pending.toLocaleString()}
              subtext="awaiting action"
              icon={IconClock}
              iconBg="bg-amber-50 dark:bg-amber-900/20"
              iconColor="text-amber-600 dark:text-amber-400"
              delayMs={100}
            />
            <KpiCard
              label="Approved"
              value={data.kpis.approved.toLocaleString()}
              subtext={`${fmtPercent(data.kpis.approvalRate)} approval rate`}
              icon={IconCheck}
              iconBg="bg-emerald-50 dark:bg-emerald-900/20"
              iconColor="text-emerald-600 dark:text-emerald-400"
              delayMs={200}
            />
            <KpiCard
              label="Avg Turnaround"
              value={fmtHoursToDays(data.kpis.avgTurnaroundHours)}
              subtext="start to completion"
              icon={IconHourglass}
              iconBg="bg-blue-50 dark:bg-blue-900/20"
              iconColor="text-blue-600 dark:text-blue-400"
              delayMs={300}
            />
          </div>

          {/* Chart section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              title="Memos over time"
              subtitle={(() => {
                if (data.memosOverTime.length === 0)
                  return "Last 30 days, by initiation date";
                const first = data.memosOverTime[0].date;
                const last = data.memosOverTime[data.memosOverTime.length - 1].date;
                return `${fmtShortDate(first)} – ${fmtShortDate(last)} (last 30 days, by initiation date)`;
              })()}
              className="lg:col-span-2"
              delayMs={400}
            >
              <div className="w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={timeChartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#02773b" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#02773b" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="currentColor"
                      className="text-gray-200 dark:text-gray-800"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "currentColor", fontSize: 11 }}
                      stroke="currentColor"
                      className="text-gray-500 dark:text-gray-400"
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: "currentColor", fontSize: 11 }}
                      stroke="currentColor"
                      className="text-gray-500 dark:text-gray-400"
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(2,119,59,0.06)" }}
                      contentStyle={{
                        background: "rgba(17,24,39,0.97)",
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 12,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                      }}
                      labelStyle={{ color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "#fff" }}
                      labelFormatter={(_label, payload) => {
                        const iso = (payload?.[0]?.payload as { date?: string })?.date;
                        return iso ? fmtDate(iso) : _label;
                      }}
                    />
                    <Bar dataKey="count" fill="url(#barFill)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Status breakdown" subtitle="Current memo statuses" delayMs={500}>
              {statusChartData.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-16">
                  No data
                </div>
              ) : (
                <>
                  <div className="w-full">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={statusChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {statusChartData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={STATUS_COLORS[entry.status] ?? "#9ca3af"}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "rgba(17,24,39,0.97)",
                            border: "none",
                            borderRadius: 8,
                            color: "#fff",
                            fontSize: 12,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                          }}
                          itemStyle={{ color: "#fff" }}
                          labelStyle={{ color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {statusChartData.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <span
                            className="w-2.5 h-2.5 rounded-sm"
                            style={{
                              background: STATUS_COLORS[s.status] ?? "#9ca3af",
                            }}
                          />
                          {s.name}
                        </span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                          {s.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          {/* Scope-conditional second row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(data.scope === "institutional" ||
              data.scope === "directorate" ||
              data.scope === "departmental") && (() => {
              const groupBy = data.topInitiatorsGroupBy ?? "user";
              const initiatorsTitle =
                groupBy === "directorate"
                  ? "Top directorates"
                  : groupBy === "department"
                    ? "Top departments"
                    : "Top initiators";
              const initiatorsSubtitle =
                groupBy === "directorate"
                  ? "By memo volume across the institution"
                  : groupBy === "department"
                    ? `By memo volume across ${data.directorate ?? "the directorate"}`
                    : `Memos started in ${data.department ?? "your department"}`;
              const recommendersSubtitle =
                data.scope === "departmental"
                  ? "Tasks completed in your department"
                  : "Tasks completed";
              return (
                <>
                  <Card
                    title={initiatorsTitle}
                    subtitle={initiatorsSubtitle}
                    delayMs={600}
                  >
                    <RankedList
                      items={data.topInitiators ?? []}
                      value={(r) => r.count}
                      max={Math.max(
                        1,
                        ...(data.topInitiators ?? []).map((r) => r.count),
                      )}
                      emptyLabel="No initiator activity yet"
                    />
                  </Card>
                  <Card
                    title="Top recommenders"
                    subtitle={recommendersSubtitle}
                    delayMs={700}
                  >
                    <RankedList
                      items={data.topRecommenders ?? []}
                      value={(r) => r.completed}
                      max={Math.max(
                        1,
                        ...(data.topRecommenders ?? []).map((r) => r.completed),
                      )}
                      emptyLabel="No recommender activity yet"
                    />
                  </Card>
                </>
              );
            })()}

            {data.scope === "individual" && (
              <>
                <Card
                  title="Your approval rate"
                  subtitle="Across all your memos"
                  delayMs={600}
                >
                  <ApprovalDonut
                    rate={data.kpis.approvalRate}
                    approved={data.kpis.approved}
                    total={data.kpis.approved + data.kpis.rejected}
                  />
                </Card>
                <Card
                  title="Status distribution"
                  subtitle="Where your memos stand"
                  delayMs={700}
                >
                  {statusChartData.length === 0 ? (
                    <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                      No data
                    </div>
                  ) : (
                    <div className="space-y-3 py-2">
                      {statusChartData.map((s, i) => {
                        const max = Math.max(
                          ...statusChartData.map((x) => x.value),
                        );
                        const pct = max > 0 ? (s.value / max) * 100 : 0;
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                                <span
                                  className="w-2.5 h-2.5 rounded-sm"
                                  style={{
                                    background:
                                      STATUS_COLORS[s.status] ?? "#9ca3af",
                                  }}
                                />
                                {s.name}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                {s.value}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  background:
                                    STATUS_COLORS[s.status] ?? "#9ca3af",
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>

          {/* Recent activity */}
          <Card
            title="Recent memos in scope"
            subtitle="10 most recently initiated"
            delayMs={800}
          >
            {data.recentActivity.length === 0 ? (
              <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                No recent activity
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <th className="px-5 py-2 font-medium">Reference</th>
                      <th className="px-5 py-2 font-medium">Subject</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium">Currently With</th>
                      <th className="px-5 py-2 font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentActivity.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => router.push(`/memos/${m.id}`)}
                        className="border-b border-gray-100 dark:border-gray-800/60 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                          {m.referenceNumber}
                        </td>
                        <td className="px-5 py-3 text-gray-900 dark:text-gray-100 max-w-md truncate">
                          {m.subject}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                              STATUS_BADGE[m.status] ?? STATUS_BADGE.DRAFT
                            }`}
                          >
                            {STATUS_LABELS[m.status] ?? m.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {m.currentAssignee?.name ?? (
                            <span className="text-gray-400 dark:text-gray-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {fmtDate(m.startedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
