"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Can } from "@/components/auth/can";
import { usePermissions } from "@/lib/use-permissions";

interface DashboardStats {
  totalDocuments: number;
  activeWorkflows: number;
  pendingTasks: number;
  recentUploads: number;
  myMemos: number;
  pendingMemos: number;
}

interface PendingTask {
  id: string;
  subject: string;
  stepName: string;
  status: string;
  dueAt: string | null;
  assignedAt: string;
}

interface RecentMemo {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  currentStepName: string | null;
  initiatedBy: { name: string; displayName: string };
  createdAt: string;
  awaitingClarification?: boolean;
  currentAssignee?: { id: string; name: string; displayName: string } | null;
}

interface MemoAnalytics {
  scope: "institutional" | "directorate" | "departmental" | "individual";
  scopeLabel: string;
  department?: string;
  kpis: {
    totalMemos: number;
    pending: number;
    approved: number;
    rejected: number;
    returned: number;
    avgTurnaroundHours: number;
    approvalRate: number;
  };
  statusBreakdown: { status: string; count: number }[];
  memosOverTime: { date: string; count: number }[];
  byDepartment: { department: string; count: number }[];
  topInitiators: { name: string; count: number }[];
  topRecommenders: { name: string; count: number; avgHours: number }[];
  recentActivity: { id: string; reference: string; subject: string; actor: string; action: string; at: string }[];
}

const MEMO_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#9ca3af",
  PENDING_RECOMMENDATION: "#f59e0b",
  PENDING_APPROVAL: "#3b82f6",
  APPROVED: "#10b981",
  REJECTED: "#ef4444",
  RETURNED: "#f97316",
  CANCELLED: "#6b7280",
  SENT: "#14b8a6",
};

const emptyStats: DashboardStats = {
  totalDocuments: 0,
  activeWorkflows: 0,
  pendingTasks: 0,
  recentUploads: 0,
  myMemos: 0,
  pendingMemos: 0,
};

/* placeholder arrays removed — data fetched from API */

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

function statusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "DRAFT":
      return "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
    case "CHECKED_OUT":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "PENDING":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "ARCHIVED":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  }
}

const statCards = [
  {
    label: "My Memos",
    key: "myMemos" as const,
    permission: "memos:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
      </svg>
    ),
    color: "text-karu-green",
    bgColor: "bg-karu-green-light dark:bg-karu-green/10",
  },
  {
    label: "Pending Memos",
    key: "pendingMemos" as const,
    permission: "memos:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
      </svg>
    ),
    color: "text-karu-gold",
    bgColor: "bg-karu-gold-light dark:bg-karu-gold/10",
  },
  {
    label: "Total Documents",
    key: "totalDocuments" as const,
    permission: "documents:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
    color: "text-karu-green",
    bgColor: "bg-karu-green-light dark:bg-karu-green/10",
  },
  {
    label: "Active Workflows",
    key: "activeWorkflows" as const,
    permission: "workflows:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
      </svg>
    ),
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
  {
    label: "Pending Tasks",
    key: "pendingTasks" as const,
    permission: "workflows:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    color: "text-karu-gold",
    bgColor: "bg-karu-gold-light dark:bg-karu-gold/10",
  },
  {
    label: "Recent Uploads",
    key: "recentUploads" as const,
    permission: "documents:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
      </svg>
    ),
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
  },
];

const quickActions = [
  {
    label: "New Memo",
    description: "Compose an internal memo",
    href: "/memos/new",
    permission: "memos:create",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zM19.5 7.125L16.875 4.5" />
      </svg>
    ),
    color: "text-karu-green",
    bgColor: "bg-karu-green-light dark:bg-karu-green/10",
    hoverBorder: "hover:border-karu-green/30",
  },
  {
    label: "Upload Document",
    description: "Add a new document to the system",
    href: "/documents/upload",
    permission: "documents:create",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
      </svg>
    ),
    color: "text-karu-green",
    bgColor: "bg-karu-green-light dark:bg-karu-green/10",
    hoverBorder: "hover:border-karu-green/30",
  },
  {
    label: "Start Workflow",
    description: "Initiate a new approval workflow",
    href: "/workflows/start",
    permission: "workflows:create",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    hoverBorder: "hover:border-blue-300 dark:hover:border-blue-700",
  },
  {
    label: "Search Records",
    description: "Find documents and records",
    href: "/search",
    permission: undefined,
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
    color: "text-karu-gold",
    bgColor: "bg-karu-gold-light dark:bg-karu-gold/10",
    hoverBorder: "hover:border-karu-gold/30",
  },
  {
    label: "View Reports",
    description: "Access analytics and reports",
    href: "/reports",
    permission: "reports:read",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
    hoverBorder: "hover:border-purple-300 dark:hover:border-purple-700",
  },
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const { can, ready } = usePermissions();
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [memos, setMemos] = useState<RecentMemo[]>([]);
  const [pendingMyAction, setPendingMyAction] = useState<RecentMemo[]>([]);
  const [myCreatedMemos, setMyCreatedMemos] = useState<RecentMemo[]>([]);
  const [analytics, setAnalytics] = useState<MemoAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const canReadDocuments = can("documents:read");
  const canReadWorkflows = can("workflows:read");
  const canReadMemos = can("memos:read");
  const visibleStatCards = statCards.filter((c) => can(c.permission));
  const visibleQuickActions = quickActions.filter((a) => can(a.permission));
  const showTasksPanel = canReadWorkflows;
  const showMemosPanel = canReadMemos;

  useEffect(() => {
    if (!ready) return;
    async function fetchDashboard() {
      try {
        const fetches: Array<Promise<Response | null>> = [
          fetch("/api/dashboard/stats").catch(() => null),
          canReadWorkflows
            ? fetch("/api/workflows/tasks?status=PENDING&limit=5").catch(() => null)
            : Promise.resolve(null),
          canReadMemos
            ? fetch("/api/memos?limit=5&page=1&scope=involved").catch(() => null)
            : Promise.resolve(null),
          canReadMemos ? fetch("/api/memos/analytics").catch(() => null) : Promise.resolve(null),
          // My Memo Centre — pending tab (memos needing my action)
          canReadMemos
            ? fetch("/api/memos?limit=5&page=1&tab=pending").catch(() => null)
            : Promise.resolve(null),
          // My Memo Centre — my created memos (for the stats tab)
          canReadMemos
            ? fetch("/api/memos?limit=200&page=1&initiatedByMe=true").catch(() => null)
            : Promise.resolve(null),
        ];
        const [
          statsRes,
          tasksRes,
          memosRes,
          analyticsRes,
          pendingRes,
          myCreatedRes,
        ] = await Promise.all(fetches);

        if (statsRes && statsRes.ok) setStats(await statsRes.json());

        if (tasksRes && tasksRes.ok) {
          const tasksData = await tasksRes.json();
          setTasks(
            (tasksData.tasks ?? []).map((t: Record<string, unknown>) => ({
              id: t.id,
              subject: (t as Record<string, Record<string, unknown>>).instance?.subject ?? t.stepName ?? "Task",
              stepName: t.stepName,
              status: t.status,
              dueAt: t.dueAt ?? t.assignedAt,
              assignedAt: t.assignedAt,
            }))
          );
        }

        const mapMemoRow = (m: Record<string, unknown>): RecentMemo => {
          const fromUser = m.from as { name?: string; displayName?: string } | undefined;
          return {
            id: m.id as string,
            referenceNumber:
              (m.memoReferenceNumber as string | null) ??
              (m.referenceNumber as string) ??
              "",
            subject: (m.subject ?? "Untitled memo") as string,
            status: (m.status ?? "DRAFT") as string,
            currentStepName: (m.currentStepName ?? null) as string | null,
            initiatedBy:
              (m.initiatedBy as { name: string; displayName: string } | undefined) ??
              {
                name: fromUser?.name ?? "",
                displayName: fromUser?.displayName ?? "",
              },
            createdAt: (m.startedAt ?? m.createdAt ?? new Date().toISOString()) as string,
            awaitingClarification: Boolean(m.awaitingClarification),
            currentAssignee:
              (m.currentAssignee as RecentMemo["currentAssignee"]) ?? null,
          };
        };

        if (memosRes && memosRes.ok) {
          const memosData = await memosRes.json();
          setMemos((memosData.memos ?? memosData.data ?? []).map(mapMemoRow));
        }
        if (pendingRes && pendingRes.ok) {
          const pendingData = await pendingRes.json();
          setPendingMyAction(
            (pendingData.memos ?? pendingData.data ?? []).map(mapMemoRow),
          );
        }
        if (myCreatedRes && myCreatedRes.ok) {
          const myData = await myCreatedRes.json();
          setMyCreatedMemos(
            (myData.memos ?? myData.data ?? []).map(mapMemoRow),
          );
        }
        if (analyticsRes && analyticsRes.ok) {
          const analyticsData = (await analyticsRes.json()) as MemoAnalytics;
          setAnalytics(analyticsData);
        }
      } catch {
        // Silently handle errors — dashboard shows empty state
      } finally {
        setIsLoadingStats(false);
        setIsLoadingAnalytics(false);
      }
    }
    fetchDashboard();
  }, [ready, canReadDocuments, canReadWorkflows, canReadMemos]);

  const userName = session?.user?.name ?? "User";
  const userRole = session?.user?.roles?.[0] ?? "Staff";

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-[#02773b] to-[#014d28] rounded-2xl p-6 lg:p-8 text-white relative overflow-hidden animate-fade-in">
        {/* Decorative pattern */}
        <div className="absolute inset-0 opacity-5">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="welcome-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#welcome-grid)" />
          </svg>
        </div>

        <div className="relative z-10">
          <h1 className="text-2xl lg:text-3xl font-bold">
            Welcome back, {userName.split(" ")[0]}
          </h1>
          <p className="text-white/80 mt-1 text-sm lg:text-base">
            {userRole} &mdash; Karatina University Electronic Document & Records Management System
          </p>
          {(canReadWorkflows || canReadDocuments || canReadMemos) && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Can permission="memos:read">
                <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm">
                  <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
                  </svg>
                  <span>{stats.pendingMemos} memos awaiting you</span>
                </div>
              </Can>
              <Can permission="workflows:read">
                <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm">
                  <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span>{stats.pendingTasks} pending tasks</span>
                </div>
              </Can>
              <Can permission="documents:read">
                <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm">
                  <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <span>{stats.recentUploads} new uploads this week</span>
                </div>
              </Can>
            </div>
          )}
        </div>
      </div>

      {/* Stats cards */}
      {visibleStatCards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {visibleStatCards.map((card, i) => (
            <div
              key={card.key}
              className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-slide-up`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {isLoadingStats ? (
                      <span className="inline-block w-16 h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    ) : (
                      stats[card.key].toLocaleString()
                    )}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-xl ${card.bgColor} flex items-center justify-center ${card.color}`}>
                  {card.icon}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      {visibleQuickActions.length > 0 && (
      <div className="animate-slide-up delay-300">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleQuickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className={`group bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 transition-all ${action.hoverBorder} hover:shadow-md`}
              >
                <div className={`w-10 h-10 rounded-lg ${action.bgColor} flex items-center justify-center ${action.color} mb-3`}>
                  {action.icon}
                </div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-karu-green transition-colors">
                  {action.label}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{action.description}</p>
              </Link>
          ))}
        </div>
      </div>
      )}

      {/* Memo Analytics */}
      <Can permission="memos:read">
        <section className="animate-slide-up delay-350">
          {isLoadingAnalytics ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
                  />
                ))}
              </div>
              <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              </div>
            </div>
          ) : analytics && analytics.kpis.totalMemos === 0 ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
              <div className="w-14 h-14 mx-auto rounded-xl bg-karu-green-light dark:bg-karu-green/10 flex items-center justify-center text-karu-green mb-3">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                No memo analytics yet
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Analytics will appear once memos start moving through workflows.
              </p>
              <Can permission="memos:create">
                <Link
                  href="/memos/new"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Compose your first memo
                </Link>
              </Can>
            </div>
          ) : analytics ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Memo Analytics
                </h2>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-karu-green text-white">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 8 8">
                    <circle cx="4" cy="4" r="3" />
                  </svg>
                  {analytics.scopeLabel}
                </span>
              </div>

              {/* KPI mini-cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: "Pending",
                    value: analytics.kpis.pending.toLocaleString(),
                    color: "text-amber-600 dark:text-amber-400",
                    bg: "bg-amber-50 dark:bg-amber-900/20",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    ),
                  },
                  {
                    label: "Approved",
                    value: analytics.kpis.approved.toLocaleString(),
                    color: "text-green-600 dark:text-green-400",
                    bg: "bg-green-50 dark:bg-green-900/20",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    ),
                  },
                  {
                    label: "Approval Rate",
                    value: `${Math.round(analytics.kpis.approvalRate * 100)}%`,
                    color: "text-blue-600 dark:text-blue-400",
                    bg: "bg-blue-50 dark:bg-blue-900/20",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
                      </svg>
                    ),
                  },
                  {
                    label: "Avg Turnaround",
                    value: `${analytics.kpis.avgTurnaroundHours.toFixed(1)}h`,
                    color: "text-purple-600 dark:text-purple-400",
                    bg: "bg-purple-50 dark:bg-purple-900/20",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    ),
                  },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3"
                  >
                    <div className={`w-10 h-10 rounded-lg ${kpi.bg} ${kpi.color} flex items-center justify-center flex-shrink-0`}>
                      {kpi.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{kpi.label}</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-tight">
                        {kpi.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Row A: 30-day trend area chart (hidden when no activity) */}
              {analytics.memosOverTime.length > 0 &&
                analytics.memosOverTime.some((d) => d.count > 0) && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Memos &mdash; Last 30 Days
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Last 30 days of activity
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {analytics.memosOverTime.reduce((sum, d) => sum + d.count, 0)} total
                  </span>
                </div>
                {(() => {
                    const trendData = analytics.memosOverTime.map((d, i) => ({
                      date: d.date,
                      count: d.count,
                      index: i,
                    }));
                    const formatTick = (dateStr: string) => {
                      const d = new Date(dateStr);
                      const mm = String(d.getMonth() + 1).padStart(2, "0");
                      const dd = String(d.getDate()).padStart(2, "0");
                      return `${mm}/${dd}`;
                    };
                    const tickFormatter = (value: string, index: number) => {
                      if (index % 5 !== 0 && index !== trendData.length - 1) return "";
                      return formatTick(value);
                    };
                    return (
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart
                          data={trendData}
                          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="memoTrendGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#02773b" stopOpacity={0.45} />
                              <stop offset="95%" stopColor="#02773b" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            vertical={false}
                            strokeDasharray="4 4"
                            stroke="#e5e7eb"
                          />
                          <XAxis
                            dataKey="date"
                            tickFormatter={tickFormatter}
                            interval={0}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            axisLine={{ stroke: "#9ca3af" }}
                            tickLine={{ stroke: "#9ca3af" }}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                            axisLine={{ stroke: "#9ca3af" }}
                            tickLine={{ stroke: "#9ca3af" }}
                            width={32}
                          />
                          <Tooltip
                            labelFormatter={(label) =>
                              new Date(label as string).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            }
                            formatter={(value) => {
                              const n = Number(value);
                              return [
                                `${n} memo${n === 1 ? "" : "s"}`,
                                "Count",
                              ];
                            }}
                            contentStyle={{
                              background: "rgba(17,24,39,0.97)",
                              border: "none",
                              borderRadius: 8,
                              color: "#fff",
                              fontSize: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                            }}
                            labelStyle={{ color: "#e5e7eb", fontWeight: 600, marginBottom: 4 }}
                            itemStyle={{ color: "#fff" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="count"
                            stroke="#02773b"
                            strokeWidth={2}
                            fill="url(#memoTrendGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    );
                  })()}
              </div>
              )}

              {/* Row B: Status donut + Top Initiators bar */}
              <div className="grid md:grid-cols-2 gap-4">
                {/* Status breakdown donut */}
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Status Breakdown
                  </h3>
                  {(() => {
                    const total = analytics.statusBreakdown.reduce(
                      (s, x) => s + x.count,
                      0
                    );
                    if (total === 0) {
                      return (
                        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                          No status data available.
                        </p>
                      );
                    }
                    const donutData = analytics.statusBreakdown
                      .filter((s) => s.count > 0)
                      .map((s) => ({
                        name: s.status,
                        value: s.count,
                        color: MEMO_STATUS_COLORS[s.status] ?? "#9ca3af",
                      }));
                    const formatName = (n: string) =>
                      n
                        .replace(/_/g, " ")
                        .toLowerCase()
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                    const renderLabel = (entry: {
                      percent?: number;
                    }): string => {
                      const pct = (entry.percent ?? 0) * 100;
                      return pct >= 5 ? `${Math.round(pct)}%` : "";
                    };
                    return (
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={2}
                            label={renderLabel}
                            labelLine={false}
                          >
                            {donutData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, _name, item) => {
                              const n = Number(value);
                              const pct = total > 0 ? (n / total) * 100 : 0;
                              const itemPayload = (item as { payload?: { name?: string } } | undefined)
                                ?.payload;
                              const label = formatName(itemPayload?.name ?? "");
                              return [
                                `${n} (${pct.toFixed(1)}%)`,
                                label,
                              ];
                            }}
                            contentStyle={{
                              background: "rgba(17,24,39,0.97)",
                              border: "none",
                              borderRadius: 8,
                              color: "#fff",
                              fontSize: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                            }}
                            labelStyle={{ color: "#e5e7eb", fontWeight: 600, marginBottom: 4 }}
                            itemStyle={{ color: "#fff" }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            height={36}
                            iconType="square"
                            iconSize={10}
                            formatter={(value: string) => (
                              <span
                                style={{
                                  color: "#6b7280",
                                  fontSize: 11,
                                }}
                              >
                                {formatName(value)}
                              </span>
                            )}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>

                {/* Top Initiators bar chart */}
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Top Initiators
                  </h3>
                  {analytics.topInitiators.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No initiators yet.
                    </p>
                  ) : (
                    (() => {
                      const initData = analytics.topInitiators.slice(0, 6);
                      // Truncate only very long names; the YAxis width below
                      // is generous so most names render in full.
                      const truncate = (s: string) =>
                        s.length > 28 ? `${s.slice(0, 27)}\u2026` : s;
                      const height = Math.max(220, initData.length * 36 + 40);
                      return (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart
                            data={initData}
                            layout="vertical"
                            margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                          >
                            <CartesianGrid
                              horizontal={false}
                              strokeDasharray="4 4"
                              stroke="#e5e7eb"
                            />
                            <XAxis
                              type="number"
                              allowDecimals={false}
                              tick={{ fill: "#9ca3af", fontSize: 11 }}
                              axisLine={{ stroke: "#9ca3af" }}
                              tickLine={{ stroke: "#9ca3af" }}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={210}
                              tick={{ fill: "#6b7280", fontSize: 11 }}
                              tickFormatter={truncate}
                              interval={0}
                              axisLine={{ stroke: "#9ca3af" }}
                              tickLine={{ stroke: "#9ca3af" }}
                            />
                            <Tooltip
                              formatter={(value) => {
                                const n = Number(value);
                                return [
                                  `${n} memo${n === 1 ? "" : "s"}`,
                                  "Count",
                                ];
                              }}
                              contentStyle={{
                              background: "rgba(17,24,39,0.97)",
                              border: "none",
                              borderRadius: 8,
                              color: "#fff",
                              fontSize: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                            }}
                            labelStyle={{ color: "#e5e7eb", fontWeight: 600, marginBottom: 4 }}
                            itemStyle={{ color: "#fff" }}
                            />
                            <Bar
                              dataKey="count"
                              fill="#dd9f42"
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>
              </div>

              {/* Row C: By Department (institutional/directorate) OR Top Recommenders list */}
              {analytics.scope === "institutional" || analytics.scope === "directorate" ? (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Memos by Department
                  </h3>
                  {analytics.byDepartment.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No department data.
                    </p>
                  ) : (
                    (() => {
                      const deptData = analytics.byDepartment.slice(0, 8);
                      // Truncate only very long names; the YAxis width below
                      // is generous so most departments render in full.
                      const truncate = (s: string) =>
                        s.length > 28 ? `${s.slice(0, 27)}\u2026` : s;
                      const height = Math.max(220, deptData.length * 36 + 40);
                      return (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart
                            data={deptData}
                            layout="vertical"
                            margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                          >
                            <CartesianGrid
                              horizontal={false}
                              strokeDasharray="4 4"
                              stroke="#e5e7eb"
                            />
                            <XAxis
                              type="number"
                              allowDecimals={false}
                              tick={{ fill: "#9ca3af", fontSize: 11 }}
                              axisLine={{ stroke: "#9ca3af" }}
                              tickLine={{ stroke: "#9ca3af" }}
                            />
                            <YAxis
                              type="category"
                              dataKey="department"
                              width={210}
                              tick={{ fill: "#6b7280", fontSize: 11 }}
                              tickFormatter={truncate}
                              interval={0}
                              axisLine={{ stroke: "#9ca3af" }}
                              tickLine={{ stroke: "#9ca3af" }}
                            />
                            <Tooltip
                              formatter={(value) => {
                                const n = Number(value);
                                return [
                                  `${n} memo${n === 1 ? "" : "s"}`,
                                  "Count",
                                ];
                              }}
                              contentStyle={{
                              background: "rgba(17,24,39,0.97)",
                              border: "none",
                              borderRadius: 8,
                              color: "#fff",
                              fontSize: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                            }}
                            labelStyle={{ color: "#e5e7eb", fontWeight: 600, marginBottom: 4 }}
                            itemStyle={{ color: "#fff" }}
                            />
                            <Bar
                              dataKey="count"
                              fill="#02773b"
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Top Recommenders
                  </h3>
                  {analytics.topRecommenders.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No recommender activity.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {analytics.topRecommenders.slice(0, 6).map((r, idx) => (
                        <li
                          key={r.name}
                          className="flex items-center gap-3 text-xs"
                        >
                          <span className="w-6 h-6 rounded-full bg-karu-green-light dark:bg-karu-green/10 text-karu-green flex items-center justify-center text-[11px] font-semibold flex-shrink-0">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-700 dark:text-gray-300 truncate font-medium">
                              {r.name}
                            </p>
                          </div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-karu-green text-white flex-shrink-0">
                            {r.count} memo{r.count === 1 ? "" : "s"}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex-shrink-0">
                            {r.avgHours.toFixed(1)}h avg
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </Can>

      {/* My Memo Centre + Pending Tasks (side by side on xl) */}
      {(showMemosPanel || showTasksPanel) && (
        <div
          className={`grid grid-cols-1 gap-6 animate-slide-up delay-400 ${
            showMemosPanel && showTasksPanel ? "xl:grid-cols-3" : ""
          }`}
        >
          {showMemosPanel && (
            <div className={showTasksPanel ? "xl:col-span-2" : ""}>
              <MyMemoCentre
                recent={memos}
                pending={pendingMyAction}
                myCreated={myCreatedMemos}
              />
            </div>
          )}

          {showTasksPanel && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Pending Tasks
                </h2>
                <Link
                  href="/workflows"
                  className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
                >
                  View all
                </Link>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {tasks.length > 0 ? (
                  tasks.slice(0, 5).map((task) => (
                    <div key={task.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 w-8 h-8 rounded-lg bg-karu-gold-light dark:bg-karu-gold/10 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-karu-gold" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                            {task.subject}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(task.status)}`}>
                              {task.stepName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>Assigned {formatRelativeDate(task.assignedAt)}</span>
                            {task.dueAt && (
                              <>
                                <span>·</span>
                                <span className="text-karu-gold font-medium">
                                  Due {formatDate(task.dueAt)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-12 text-center">
                    <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    <p className="text-sm text-gray-500 dark:text-gray-400">No pending tasks</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">You&#39;re all caught up!</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  My Memo Centre — three-tab panel: Recent / Pending / Stats        */
/* ------------------------------------------------------------------ */

type MemoCentreTab = "recent" | "pending" | "stats";

function MyMemoCentre({
  recent,
  pending,
  myCreated,
}: {
  recent: RecentMemo[];
  pending: RecentMemo[];
  myCreated: RecentMemo[];
}) {
  const [tab, setTab] = useState<MemoCentreTab>("recent");

  const stats = {
    approved: myCreated.filter((m) => m.status === "APPROVED" || m.status === "SENT").length,
    pendingRecommendation: myCreated.filter((m) => m.status === "PENDING_RECOMMENDATION").length,
    pendingApproval: myCreated.filter((m) => m.status === "PENDING_APPROVAL").length,
    rejected: myCreated.filter((m) => m.status === "REJECTED").length,
    drafts: myCreated.filter((m) => m.status === "DRAFT").length,
    awaitingClarification: myCreated.filter((m) => m.awaitingClarification).length,
  };

  const tabs: { key: MemoCentreTab; label: string; count?: number }[] = [
    { key: "recent", label: "Recent", count: recent.length },
    { key: "pending", label: "Pending", count: pending.length },
    { key: "stats", label: "Stats" },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          My Memo Centre
        </h2>
        {tab === "recent" && (
          <Link
            href="/memos"
            className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
          >
            View all
          </Link>
        )}
        {tab === "pending" && (
          <Link
            href="/memos?tab=pending"
            className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
          >
            View all
          </Link>
        )}
        {tab === "stats" && (
          <Link
            href="/memos/trace"
            className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
          >
            Trace my memos
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 py-2.5 px-3 -mb-px border-b-2 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-karu-green text-karu-green"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold ${
                  tab === t.key
                    ? "bg-karu-green text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === "recent" && <MemoListBody memos={recent.slice(0, 5)} emptyMessage="No recent memos involving you" />}
      {tab === "pending" && (
        <MemoListBody
          memos={pending.slice(0, 5)}
          emptyMessage="Nothing waiting for your action"
          emptySubtitle="You're all caught up!"
        />
      )}
      {tab === "stats" && <MemoStatsGrid stats={stats} total={myCreated.length} />}
    </div>
  );
}

function MemoListBody({
  memos,
  emptyMessage,
  emptySubtitle,
}: {
  memos: RecentMemo[];
  emptyMessage: string;
  emptySubtitle?: string;
}) {
  if (memos.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <div className="w-10 h-10 mx-auto rounded-full bg-karu-green/10 flex items-center justify-center mb-3">
          <svg className="w-5 h-5 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{emptyMessage}</p>
        {emptySubtitle && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{emptySubtitle}</p>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {memos.map((memo) => (
        <Link
          key={memo.id}
          href={`/memos/${memo.id}`}
          className="block px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {memo.subject}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                <span className="font-mono">{memo.referenceNumber}</span>
                {memo.initiatedBy?.displayName && ` · from ${memo.initiatedBy.displayName}`}
                {memo.currentAssignee?.displayName &&
                  ` · with ${memo.currentAssignee.displayName}`}
                {memo.currentStepName && ` · ${memo.currentStepName}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${memoStatusBadge(memo.status)}`}
              >
                {memo.status.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
                {formatRelativeDate(memo.createdAt)}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function MemoStatsGrid({
  stats,
  total,
}: {
  stats: {
    approved: number;
    pendingRecommendation: number;
    pendingApproval: number;
    rejected: number;
    drafts: number;
    awaitingClarification: number;
  };
  total: number;
}) {
  const items: { label: string; value: number; tone: string; href: string }[] = [
    {
      label: "Approved",
      value: stats.approved,
      tone: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900",
      href: "/memos/trace?tab=approved",
    },
    {
      label: "Pending Recommendation",
      value: stats.pendingRecommendation,
      tone: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 ring-amber-200 dark:ring-amber-900",
      href: "/memos/trace?tab=in-progress",
    },
    {
      label: "Pending Approval",
      value: stats.pendingApproval,
      tone: "text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 ring-blue-200 dark:ring-blue-900",
      href: "/memos/trace?tab=in-progress",
    },
    {
      label: "Rejected",
      value: stats.rejected,
      tone: "text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300 ring-red-200 dark:ring-red-900",
      href: "/memos/trace?tab=rejected",
    },
    {
      label: "Drafts",
      value: stats.drafts,
      tone: "text-gray-700 bg-gray-100 dark:bg-gray-800 dark:text-gray-200 ring-gray-200 dark:ring-gray-700",
      href: "/memos/trace?tab=in-progress",
    },
    {
      label: "Awaiting Clarification",
      value: stats.awaitingClarification,
      tone: "text-orange-700 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-300 ring-orange-200 dark:ring-orange-900",
      href: "/memos/trace",
    },
  ];

  if (total === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <div className="w-10 h-10 mx-auto rounded-full bg-karu-green/10 flex items-center justify-center mb-3">
          <svg className="w-5 h-5 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
          </svg>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">You haven&apos;t initiated any memos yet</p>
        <Link
          href="/memos/new"
          className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-karu-green hover:text-karu-green-dark"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Compose your first memo
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Stats for the <span className="font-semibold text-gray-700 dark:text-gray-300">{total}</span> memo{total === 1 ? "" : "s"} you have initiated
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`flex flex-col gap-1 px-3 py-3 rounded-lg ring-1 transition-colors hover:brightness-95 dark:hover:brightness-110 ${item.tone}`}
          >
            <span className="text-2xl font-bold leading-none tabular-nums">
              {item.value}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wider opacity-80 line-clamp-2">
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* Memo-status badge palette (richer than the generic statusColor) */
function memoStatusBadge(status: string): string {
  switch (status) {
    case "APPROVED":
    case "SENT":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "PENDING_RECOMMENDATION":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
    case "PENDING_APPROVAL":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
    case "REJECTED":
      return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
    case "RETURNED":
      return "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300";
    case "DRAFT":
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  }
}
