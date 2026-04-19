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

interface RecentDocument {
  id: string;
  referenceNumber: string;
  title: string;
  documentType: string;
  status: string;
  department: string;
  createdAt: string;
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
  const [documents, setDocuments] = useState<RecentDocument[]>([]);
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [memos, setMemos] = useState<RecentMemo[]>([]);
  const [analytics, setAnalytics] = useState<MemoAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const canReadDocuments = can("documents:read");
  const canReadWorkflows = can("workflows:read");
  const canReadMemos = can("memos:read");
  const visibleStatCards = statCards.filter((c) => can(c.permission));
  const visibleQuickActions = quickActions.filter((a) => can(a.permission));
  const showDocumentsPanel = canReadDocuments;
  const showTasksPanel = canReadWorkflows;
  const showMemosPanel = canReadMemos;

  useEffect(() => {
    if (!ready) return;
    async function fetchDashboard() {
      try {
        const fetches: Array<Promise<Response | null>> = [
          fetch("/api/dashboard/stats").catch(() => null),
          canReadDocuments ? fetch("/api/documents?limit=8&page=1").catch(() => null) : Promise.resolve(null),
          canReadWorkflows
            ? fetch("/api/workflows/tasks?status=PENDING&limit=5").catch(() => null)
            : Promise.resolve(null),
          canReadMemos
            ? fetch("/api/memos?limit=5&page=1&scope=involved").catch(() => null)
            : Promise.resolve(null),
          canReadMemos ? fetch("/api/memos/analytics").catch(() => null) : Promise.resolve(null),
        ];
        const [statsRes, docsRes, tasksRes, memosRes, analyticsRes] = await Promise.all(fetches);

        if (statsRes && statsRes.ok) setStats(await statsRes.json());

        if (docsRes && docsRes.ok) {
          const docsData = await docsRes.json();
          setDocuments(
            (docsData.documents ?? []).map((d: Record<string, unknown>) => ({
              id: d.id,
              referenceNumber: d.referenceNumber,
              title: d.title,
              documentType: d.documentType,
              status: d.status,
              department: d.department,
              createdAt: d.createdAt,
            }))
          );
        }

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

        if (memosRes && memosRes.ok) {
          const memosData = await memosRes.json();
          setMemos(
            (memosData.memos ?? memosData.data ?? []).map((m: Record<string, unknown>) => ({
              id: m.id as string,
              referenceNumber: (m.referenceNumber ?? "") as string,
              subject: (m.subject ?? "Untitled memo") as string,
              status: (m.status ?? "DRAFT") as string,
              currentStepName: (m.currentStepName ?? null) as string | null,
              initiatedBy: (m.initiatedBy as { name: string; displayName: string } | undefined) ?? {
                name: "",
                displayName: "",
              },
              createdAt: (m.createdAt ?? new Date().toISOString()) as string,
            }))
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
    <div className="p-4 lg:p-6 space-y-6 w-full">
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
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                              fontSize: 12,
                            }}
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
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                              fontSize: 12,
                            }}
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
                      const truncate = (s: string) =>
                        s.length > 16 ? `${s.slice(0, 15)}\u2026` : s;
                      const height = Math.max(200, initData.length * 28 + 40);
                      return (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart
                            data={initData}
                            layout="vertical"
                            margin={{ top: 4, right: 16, left: 80, bottom: 4 }}
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
                              width={120}
                              tick={{ fill: "#6b7280", fontSize: 11 }}
                              tickFormatter={truncate}
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
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                fontSize: 12,
                              }}
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
                      const truncate = (s: string) =>
                        s.length > 16 ? `${s.slice(0, 15)}\u2026` : s;
                      const height = Math.max(200, deptData.length * 28 + 40);
                      return (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart
                            data={deptData}
                            layout="vertical"
                            margin={{ top: 4, right: 16, left: 80, bottom: 4 }}
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
                              width={120}
                              tick={{ fill: "#6b7280", fontSize: 11 }}
                              tickFormatter={truncate}
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
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                fontSize: 12,
                              }}
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

      {/* Recent memos (visible to all memo-read users) */}
      {showMemosPanel && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-slide-up delay-400">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent Memos</h2>
            <Link
              href="/memos"
              className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {memos.length > 0 ? (
              memos.map((memo) => (
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
                        {memo.referenceNumber}
                        {memo.initiatedBy?.displayName && ` · from ${memo.initiatedBy.displayName}`}
                        {memo.currentStepName && ` · ${memo.currentStepName}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(memo.status)}`}
                      >
                        {memo.status.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
                        {formatRelativeDate(memo.createdAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-5 py-10 text-center">
                <svg
                  className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z"
                  />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">No memos yet</p>
                <Can permission="memos:create">
                  <Link
                    href="/memos/new"
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-karu-green hover:text-karu-green-dark"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Compose your first memo
                  </Link>
                </Can>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-column layout: Documents table + Pending tasks */}
      {(showDocumentsPanel || showTasksPanel) && (
      <div className={`grid grid-cols-1 gap-6 animate-slide-up delay-500 ${showDocumentsPanel && showTasksPanel ? "xl:grid-cols-3" : ""}`}>
        {/* Recent documents */}
        {showDocumentsPanel && (
        <div className={`${showTasksPanel ? "xl:col-span-2" : ""} bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent Documents</h2>
            <Link
              href="/documents"
              className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
            >
              View all
            </Link>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Reference
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Title
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Type
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                        {doc.referenceNumber}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="text-sm text-gray-900 dark:text-gray-100 hover:text-karu-green transition-colors line-clamp-1"
                      >
                        {doc.title}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{doc.department}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {doc.documentType.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(doc.status)}`}>
                        {doc.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatRelativeDate(doc.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
            {documents.slice(0, 5).map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="block px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {doc.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {doc.referenceNumber} &middot; {doc.department}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(doc.status)}`}>
                    {doc.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
        )}

        {/* Pending tasks */}
        {showTasksPanel && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pending Tasks</h2>
            <Link
              href="/workflows"
              className="text-sm text-karu-green hover:text-karu-green-dark font-medium transition-colors"
            >
              View all
            </Link>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {tasks.length > 0 ? (
              tasks.map((task) => (
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
                            <span>&middot;</span>
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
