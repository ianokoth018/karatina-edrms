"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BarItem {
  label: string;
  value: number;
}

interface DocumentsData {
  byStatus: { status: string; count: number }[];
  byDepartment: { department: string; count: number }[];
  byType: { type: string; count: number }[];
  recentTrend: { month: string; count: number }[];
}

interface WorkflowsData {
  byStatus: { status: string; count: number }[];
  avgCompletionDays: number | null;
  completedByMonth: { month: string; count: number }[];
}

interface UsersData {
  totalUsers: number;
  activeUsers: number;
  byDepartment: { department: string; count: number }[];
  recentLogins: { last7Days: number; last30Days: number };
}

interface AuditData {
  totalEntries: number;
  byAction: { action: string; count: number }[];
  byResourceType: { resourceType: string; count: number }[];
  recentActivity: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    userName: string;
    occurredAt: string;
    metadata: unknown;
  }[];
}

interface PhysicalData {
  byStatus: { status: string; count: number }[];
  byLocation: { location: string; count: number }[];
  checkedOutCount: number;
}

interface RetentionData {
  dueForDisposal: number;
  byDisposalAction: { action: string; count: number }[];
}

type ReportData =
  | DocumentsData
  | WorkflowsData
  | UsersData
  | AuditData
  | PhysicalData
  | RetentionData;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REPORT_META: Record<
  string,
  { title: string; description: string }
> = {
  documents: {
    title: "Document Statistics",
    description: "Overview of documents by type, status, and department",
  },
  workflows: {
    title: "Workflow Performance",
    description: "Memo and workflow processing times and bottlenecks",
  },
  users: {
    title: "User Activity",
    description: "Login history, active users, and role-based activity summary",
  },
  audit: {
    title: "Audit Trail Report",
    description: "Comprehensive log of all user actions in the system",
  },
  physical: {
    title: "Physical Records",
    description: "Tracking report for physical record locations and movements",
  },
  retention: {
    title: "Retention & Disposition",
    description: "Records due for disposal and retention schedule compliance",
  },
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#6b7280",
  ACTIVE: "#02773b",
  CHECKED_OUT: "#d97706",
  ARCHIVED: "#6366f1",
  PENDING_DISPOSAL: "#ef4444",
  DISPOSED: "#9ca3af",
  PENDING: "#d97706",
  IN_PROGRESS: "#3b82f6",
  COMPLETED: "#02773b",
  REJECTED: "#ef4444",
  CANCELLED: "#9ca3af",
  AVAILABLE: "#02773b",
  TRANSFERRED: "#6366f1",
  DESTROY: "#ef4444",
  ARCHIVE_PERMANENT: "#6366f1",
  REVIEW: "#d97706",
};

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------
function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </p>
      <p
        className={`text-2xl font-bold mt-1 ${
          accent
            ? "text-[#02773b]"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function HorizontalBarChart({
  items,
  title,
}: {
  items: BarItem[];
  title: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">No data available</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const pct = Math.round((item.value / max) * 100);
            const color =
              STATUS_COLORS[item.label] ?? "#02773b";
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[60%]">
                    {formatLabel(item.label)}
                  </span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                    {item.value.toLocaleString()}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DataTable({
  columns,
  rows,
  title,
}: {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  title: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="p-5 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="text-left px-5 py-3 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-8 text-center text-gray-400"
                >
                  No data available
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap"
                    >
                      {formatCell(col.key, row[col.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(key: string, value: unknown): string {
  if (value == null) return "-";
  if (key === "occurredAt" || key.endsWith("At")) {
    return new Date(value as string).toLocaleString();
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function monthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleString("default", { month: "short", year: "2-digit" });
}

// ---------------------------------------------------------------------------
// Report sections
// ---------------------------------------------------------------------------
function DocumentsReport({ data }: { data: DocumentsData }) {
  const totalDocs = data.byStatus.reduce((s, r) => s + r.count, 0);
  const activeDocs =
    data.byStatus.find((r) => r.status === "ACTIVE")?.count ?? 0;
  const archivedDocs =
    data.byStatus.find((r) => r.status === "ARCHIVED")?.count ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Documents" value={totalDocs.toLocaleString()} accent />
        <StatCard label="Active" value={activeDocs.toLocaleString()} />
        <StatCard label="Archived" value={archivedDocs.toLocaleString()} />
        <StatCard
          label="Types Tracked"
          value={data.byType.length}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Documents by Status"
          items={data.byStatus.map((r) => ({
            label: r.status,
            value: r.count,
          }))}
        />
        <HorizontalBarChart
          title="Documents by Department (Top 10)"
          items={data.byDepartment.map((r) => ({
            label: r.department,
            value: r.count,
          }))}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Documents by Type (Top 10)"
          items={data.byType.map((r) => ({
            label: r.type,
            value: r.count,
          }))}
        />
        <HorizontalBarChart
          title="Monthly Creation Trend (Last 6 Months)"
          items={data.recentTrend.map((r) => ({
            label: monthLabel(r.month),
            value: r.count,
          }))}
        />
      </div>
      <DataTable
        title="Status Breakdown"
        columns={[
          { key: "status", label: "Status" },
          { key: "count", label: "Count" },
        ]}
        rows={data.byStatus.map((r) => ({
          status: formatLabel(r.status),
          count: r.count,
        }))}
      />
    </>
  );
}

function WorkflowsReport({ data }: { data: WorkflowsData }) {
  const totalWorkflows = data.byStatus.reduce((s, r) => s + r.count, 0);
  const completed =
    data.byStatus.find((r) => r.status === "COMPLETED")?.count ?? 0;
  const inProgress =
    data.byStatus.find((r) => r.status === "IN_PROGRESS")?.count ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Workflows" value={totalWorkflows.toLocaleString()} accent />
        <StatCard label="Completed" value={completed.toLocaleString()} />
        <StatCard label="In Progress" value={inProgress.toLocaleString()} />
        <StatCard
          label="Avg. Completion (days)"
          value={data.avgCompletionDays ?? "N/A"}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Workflows by Status"
          items={data.byStatus.map((r) => ({
            label: r.status,
            value: r.count,
          }))}
        />
        <HorizontalBarChart
          title="Completed by Month (Last 6 Months)"
          items={data.completedByMonth.map((r) => ({
            label: monthLabel(r.month),
            value: r.count,
          }))}
        />
      </div>
      <DataTable
        title="Status Breakdown"
        columns={[
          { key: "status", label: "Status" },
          { key: "count", label: "Count" },
        ]}
        rows={data.byStatus.map((r) => ({
          status: formatLabel(r.status),
          count: r.count,
        }))}
      />
    </>
  );
}

function UsersReport({ data }: { data: UsersData }) {
  const inactiveUsers = data.totalUsers - data.activeUsers;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={data.totalUsers.toLocaleString()} accent />
        <StatCard label="Active Users" value={data.activeUsers.toLocaleString()} />
        <StatCard label="Inactive Users" value={inactiveUsers.toLocaleString()} />
        <StatCard
          label="Logins (Last 7 Days)"
          value={data.recentLogins.last7Days.toLocaleString()}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Users by Department"
          items={data.byDepartment.map((r) => ({
            label: r.department,
            value: r.count,
          }))}
        />
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Login Activity
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Last 7 days
                </span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {data.recentLogins.last7Days} / {data.totalUsers} users
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      data.totalUsers > 0
                        ? Math.round(
                            (data.recentLogins.last7Days / data.totalUsers) * 100
                          )
                        : 0
                    }%`,
                    backgroundColor: "#02773b",
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Last 30 days
                </span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {data.recentLogins.last30Days} / {data.totalUsers} users
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      data.totalUsers > 0
                        ? Math.round(
                            (data.recentLogins.last30Days / data.totalUsers) *
                              100
                          )
                        : 0
                    }%`,
                    backgroundColor: "#3b82f6",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <DataTable
        title="Users by Department"
        columns={[
          { key: "department", label: "Department" },
          { key: "count", label: "Users" },
        ]}
        rows={data.byDepartment.map((r) => ({
          department: r.department,
          count: r.count,
        }))}
      />
    </>
  );
}

function AuditReport({ data }: { data: AuditData }) {
  const topAction = data.byAction[0];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Audit Entries"
          value={data.totalEntries.toLocaleString()}
          accent
        />
        <StatCard
          label="Action Types"
          value={data.byAction.length}
        />
        <StatCard
          label="Resource Types"
          value={data.byResourceType.length}
        />
        <StatCard
          label="Most Common Action"
          value={topAction ? formatLabel(topAction.action) : "N/A"}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Entries by Action (Top 10)"
          items={data.byAction.map((r) => ({
            label: r.action,
            value: r.count,
          }))}
        />
        <HorizontalBarChart
          title="Entries by Resource Type"
          items={data.byResourceType.map((r) => ({
            label: r.resourceType,
            value: r.count,
          }))}
        />
      </div>
      <DataTable
        title="Recent Activity (Last 50 Entries)"
        columns={[
          { key: "userName", label: "User" },
          { key: "action", label: "Action" },
          { key: "resourceType", label: "Resource" },
          { key: "resourceId", label: "Resource ID" },
          { key: "occurredAt", label: "Time" },
        ]}
        rows={data.recentActivity}
      />
    </>
  );
}

function PhysicalReport({ data }: { data: PhysicalData }) {
  const totalRecords = data.byStatus.reduce((s, r) => s + r.count, 0);
  const available =
    data.byStatus.find((r) => r.status === "AVAILABLE")?.count ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Records" value={totalRecords.toLocaleString()} accent />
        <StatCard label="Available" value={available.toLocaleString()} />
        <StatCard
          label="Checked Out"
          value={data.checkedOutCount.toLocaleString()}
        />
        <StatCard label="Locations" value={data.byLocation.length} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Records by Status"
          items={data.byStatus.map((r) => ({
            label: r.status,
            value: r.count,
          }))}
        />
        <HorizontalBarChart
          title="Records by Location (Top 10)"
          items={data.byLocation.map((r) => ({
            label: r.location,
            value: r.count,
          }))}
        />
      </div>
      <DataTable
        title="Status Breakdown"
        columns={[
          { key: "status", label: "Status" },
          { key: "count", label: "Count" },
        ]}
        rows={data.byStatus.map((r) => ({
          status: formatLabel(r.status),
          count: r.count,
        }))}
      />
    </>
  );
}

function RetentionReport({ data }: { data: RetentionData }) {
  const totalSchedules = data.byDisposalAction.reduce(
    (s, r) => s + r.count,
    0
  );

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Due for Disposal"
          value={data.dueForDisposal.toLocaleString()}
          accent
        />
        <StatCard
          label="Retention Schedules"
          value={totalSchedules.toLocaleString()}
        />
        <StatCard
          label="Disposal Actions"
          value={data.byDisposalAction.length}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HorizontalBarChart
          title="Schedules by Disposal Action"
          items={data.byDisposalAction.map((r) => ({
            label: r.action,
            value: r.count,
          }))}
        />
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Disposition Summary
          </h3>
          {data.dueForDisposal > 0 ? (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30">
              <svg
                className="w-5 h-5 text-red-500 shrink-0 mt-0.5"
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
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  {data.dueForDisposal} document
                  {data.dueForDisposal !== 1 ? "s" : ""} past retention
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  These documents have exceeded their retention period and
                  require disposition action.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30">
              <svg
                className="w-5 h-5 text-green-500 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  All documents within retention
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  No documents currently require disposition action.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <DataTable
        title="Disposal Action Breakdown"
        columns={[
          { key: "action", label: "Disposal Action" },
          { key: "count", label: "Schedules" },
        ]}
        rows={data.byDisposalAction.map((r) => ({
          action: formatLabel(r.action),
          count: r.count,
        }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5"
          >
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
            <div className="h-7 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 h-64"
          >
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-6" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="mb-4">
                <div className="flex justify-between mb-1">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-3 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
                <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = use(params);
  const meta = REPORT_META[type];

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?type=${type}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  if (!meta) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Unknown report type: <strong>{type}</strong>
          </p>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#02773b] mt-4 hover:underline"
          >
            Back to Reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Link
          href="/reports"
          className="hover:text-[#02773b] transition-colors"
        >
          Reports
        </Link>
        <svg
          className="w-3 h-3"
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
          {meta.title}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {meta.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {meta.description}
          </p>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl bg-[#02773b] text-white hover:bg-[#025f2f] disabled:opacity-50 transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-2xl p-4 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-500 shrink-0 mt-0.5"
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
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              Failed to load report
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <Skeleton />
      ) : data ? (
        <ReportContent type={type} data={data} />
      ) : null}
    </div>
  );
}

function ReportContent({
  type,
  data,
}: {
  type: string;
  data: ReportData;
}) {
  switch (type) {
    case "documents":
      return <DocumentsReport data={data as DocumentsData} />;
    case "workflows":
      return <WorkflowsReport data={data as WorkflowsData} />;
    case "users":
      return <UsersReport data={data as UsersData} />;
    case "audit":
      return <AuditReport data={data as AuditData} />;
    case "physical":
      return <PhysicalReport data={data as PhysicalData} />;
    case "retention":
      return <RetentionReport data={data as RetentionData} />;
    default:
      return null;
  }
}
