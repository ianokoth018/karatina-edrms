"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardStats {
  totalDocuments: number;
  activeWorkflows: number;
  pendingTasks: number;
  recentUploads: number;
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

// Placeholder data
const placeholderStats: DashboardStats = {
  totalDocuments: 1_284,
  activeWorkflows: 23,
  pendingTasks: 7,
  recentUploads: 42,
};

const placeholderDocuments: RecentDocument[] = [
  {
    id: "1",
    referenceNumber: "DOC-2026-001245",
    title: "Staff Leave Application - March 2026",
    documentType: "FORM",
    status: "ACTIVE",
    department: "Human Resources",
    createdAt: "2026-03-27T08:30:00Z",
  },
  {
    id: "2",
    referenceNumber: "DOC-2026-001244",
    title: "Faculty Board Minutes - ICT Department",
    documentType: "MEMO",
    status: "ACTIVE",
    department: "ICT",
    createdAt: "2026-03-26T14:15:00Z",
  },
  {
    id: "3",
    referenceNumber: "DOC-2026-001243",
    title: "Student Transcript Request - BSC/CS/2024",
    documentType: "STUDENT_FILE",
    status: "ACTIVE",
    department: "Academic Registry",
    createdAt: "2026-03-26T10:00:00Z",
  },
  {
    id: "4",
    referenceNumber: "DOC-2026-001242",
    title: "Procurement Tender - Lab Equipment",
    documentType: "LETTER",
    status: "DRAFT",
    department: "Procurement",
    createdAt: "2026-03-25T16:45:00Z",
  },
  {
    id: "5",
    referenceNumber: "DOC-2026-001241",
    title: "Research Grant Progress Report - Q1",
    documentType: "REPORT",
    status: "ACTIVE",
    department: "Research",
    createdAt: "2026-03-25T09:20:00Z",
  },
  {
    id: "6",
    referenceNumber: "DOC-2026-001240",
    title: "Senate Meeting Agenda - April 2026",
    documentType: "MEMO",
    status: "DRAFT",
    department: "Vice Chancellor",
    createdAt: "2026-03-24T11:30:00Z",
  },
  {
    id: "7",
    referenceNumber: "DOC-2026-001239",
    title: "Vehicle Maintenance Schedule",
    documentType: "FORM",
    status: "ACTIVE",
    department: "Transport",
    createdAt: "2026-03-24T08:00:00Z",
  },
  {
    id: "8",
    referenceNumber: "DOC-2026-001238",
    title: "Library Acquisition List - 2026",
    documentType: "REPORT",
    status: "CHECKED_OUT",
    department: "Library",
    createdAt: "2026-03-23T15:10:00Z",
  },
];

const placeholderTasks: PendingTask[] = [
  {
    id: "1",
    subject: "Approve Leave Application - John Mwangi",
    stepName: "HOD Approval",
    status: "PENDING",
    dueAt: "2026-03-29T17:00:00Z",
    assignedAt: "2026-03-27T08:30:00Z",
  },
  {
    id: "2",
    subject: "Review Procurement Tender - Lab Equipment",
    stepName: "Finance Review",
    status: "PENDING",
    dueAt: "2026-03-30T17:00:00Z",
    assignedAt: "2026-03-26T10:00:00Z",
  },
  {
    id: "3",
    subject: "Sign Transcript Request - BSC/CS/2024",
    stepName: "Registrar Approval",
    status: "PENDING",
    dueAt: "2026-03-28T17:00:00Z",
    assignedAt: "2026-03-26T11:00:00Z",
  },
];

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
    label: "Total Documents",
    key: "totalDocuments" as const,
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
    label: "Upload Document",
    description: "Add a new document to the system",
    href: "/documents/upload",
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
    href: "/workflows/designer",
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
  const [stats, setStats] = useState<DashboardStats>(placeholderStats);
  const [documents] = useState<RecentDocument[]>(placeholderDocuments);
  const [tasks] = useState<PendingTask[]>(placeholderTasks);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        // Fall back to placeholder data silently
      } finally {
        setIsLoadingStats(false);
      }
    }
    fetchStats();
  }, []);

  const userName = session?.user?.name ?? "User";
  const userRole = session?.user?.roles?.[0] ?? "Staff";

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
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
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm">
              <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span>{stats.pendingTasks} pending tasks</span>
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm">
              <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <span>{stats.recentUploads} new uploads this week</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
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

      {/* Quick actions */}
      <div className="animate-slide-up delay-300">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((action) => (
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

      {/* Two-column layout: Documents table + Pending tasks */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-slide-up delay-500">
        {/* Recent documents */}
        <div className="xl:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
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

        {/* Pending tasks */}
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
      </div>
    </div>
  );
}
