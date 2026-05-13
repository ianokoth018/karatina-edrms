"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { usePermissions } from "@/lib/use-permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowCustomView {
  id: string;
  label: string;
  description?: string;
  filter: string;
}

interface WorkflowModule {
  id: string;
  name: string;
  slug: string;
  instanceName: string | null;
  sidebarIcon: string | null;
  sidebarOrder: number;
  customQueries: WorkflowCustomView[];
}

function WorkflowModuleIcon({ name, className }: { name: string; className?: string }) {
  const cls = className ?? "w-5 h-5";
  switch (name) {
    case "users": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>;
    case "briefcase": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z" /></svg>;
    case "academic-cap": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 3.741-3.342M12 3.493V2.25m0 5.25a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0Z" /></svg>;
    case "building": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>;
    case "clipboard": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" /></svg>;
    case "chart-bar": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>;
    case "arrow-path": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>;
    case "envelope": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>;
    case "shield": return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>;
    default: return <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>;
  }
}

interface ChildItem {
  label: string;
  href: string;
  badge?: number;
  /** Permission required (in addition to parent permission) to see this child.
   *  Admins (admin:manage) bypass all child permission checks. */
  permission?: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Permission string (resource:action) required to see this item.
   *  Leave undefined for items visible to all authenticated users.
   *  Admins (admin:manage) bypass all checks. */
  permission?: string;
  children?: ChildItem[];
}

// ─── Navigation definition ────────────────────────────────────────────────────
// Each item declares which permission gates it. Child items can have their own
// narrower permission (e.g. "workflows:manage" for the designer, even though
// the parent only requires "workflows:read").
// ─────────────────────────────────────────────────────────────────────────────

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
      </svg>
    ),
  },
  {
    label: "Memos",
    href: "/memos",
    permission: "memos:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.5-4.039a2.25 2.25 0 0 1 2.134 0l7.5 4.039a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
      </svg>
    ),
    children: [
      { label: "Inbox", href: "/memos" },
      { label: "My Drafts", href: "/memos?tab=drafts", permission: "memos:create" },
      { label: "Trace My Memos", href: "/memos/trace" },
      { label: "Analytics", href: "/memos/analytics", permission: "reports:read" },
      { label: "New Memo", href: "/memos/new", permission: "memos:create" },
    ],
  },
  {
    label: "Correspondence",
    href: "/correspondence",
    permission: "correspondence:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
    children: [
      { label: "Incoming", href: "/correspondence?type=INCOMING" },
      { label: "Outgoing", href: "/correspondence?type=OUTGOING" },
      { label: "Register New", href: "/correspondence/new", permission: "correspondence:create" },
    ],
  },
  {
    label: "Documents",
    href: "/documents",
    permission: "documents:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
    children: [
      { label: "Browse", href: "/documents" },
      { label: "Upload", href: "/documents/upload", permission: "documents:create" },
    ],
  },
  {
    label: "Workflows",
    href: "/workflows",
    permission: "workflows:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
      </svg>
    ),
    children: [
      { label: "My Tasks", href: "/workflows" },
      { label: "Start New", href: "/workflows/start", permission: "workflows:create" },
      { label: "History", href: "/workflows/history" },
      { label: "Pool Tasks", href: "/workflows/pool-tasks", permission: "workflows:read" },
      { label: "Templates", href: "/workflows/templates", permission: "workflows:manage" },
      { label: "Designer", href: "/workflows/designer", permission: "workflows:manage" },
      { label: "Pools", href: "/workflows/pools", permission: "workflows:manage" },
      { label: "Monitor", href: "/workflows/monitor", permission: "workflows:manage" },
      { label: "Analytics", href: "/workflows/analytics", permission: "workflows:manage" },
    ],
  },
  {
    label: "Records",
    href: "/records",
    permission: "records:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
      </svg>
    ),
    children: [
      { label: "Casefolders",     href: "/records/casefolders",   permission: "records_casefolders:read" },
      { label: "Classification",  href: "/records/classification", permission: "records_classification:read" },
      { label: "Retention",       href: "/records/retention",     permission: "records_retention:read" },
      { label: "Physical Records",href: "/records/physical",      permission: "records_physical:read" },
      { label: "Disposition",     href: "/records/disposition",   permission: "records_disposition:read" },
      { label: "Auto Capture",    href: "/records/capture",       permission: "records_capture:read" },
      { label: "Legal holds",     href: "/admin/matters",         permission: "admin:manage" },
      { label: "Digitisation",    href: "/admin/digitisation",    permission: "admin:manage" },
    ],
  },
  {
    label: "Search",
    href: "/search",
    // No permission — available to all authenticated users
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
  },
  {
    label: "Calendar",
    href: "/calendar",
    // No permission — available to all authenticated users
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
      </svg>
    ),
  },
  {
    label: "Forms",
    href: "/forms",
    permission: "forms:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
      </svg>
    ),
    children: [
      { label: "All Forms", href: "/forms" },
      { label: "Form Designer", href: "/forms/designer", permission: "forms:manage" },
    ],
  },
  {
    label: "Reports",
    href: "/reports",
    permission: "reports:read",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    label: "Admin",
    href: "/admin",
    permission: "admin:manage",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
    children: [
      { label: "Users", href: "/admin/users" },
      { label: "Roles", href: "/admin/roles" },
      { label: "Settings", href: "/admin/settings" },
      { label: "Work Calendar", href: "/admin/work-calendar" },
      { label: "Form Data", href: "/admin/form-data" },
      { label: "Escalation Matrix", href: "/admin/escalation-matrix" },
      { label: "Leave Management", href: "/admin/leave-management" },
      { label: "Audit Trail", href: "/admin/audit" },
      { label: "Compliance", href: "/admin/compliance" },
      { label: "Email Integration", href: "/admin/email" },
      { label: "DocuSign Integration", href: "/admin/integrations/docusign" },
      { label: "Nitro Sign Integration", href: "/admin/integrations/nitro" },
      { label: "Translations", href: "/admin/translations" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function UserInitials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="w-9 h-9 rounded-full bg-karu-green flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
      {initials}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { can } = usePermissions();

  const userRoles: string[] = session?.user?.roles ?? [];

  const [workflowModules, setWorkflowModules] = useState<WorkflowModule[]>([]);

  useEffect(() => {
    if (!session?.user) return;
    function loadModules() {
      fetch("/api/workflows/sidebar")
        .then((r) => r.ok ? r.json() : { modules: [] })
        .then((data) => setWorkflowModules(data.modules ?? []))
        .catch(() => {});
    }
    loadModules();
    // Re-fetch when window regains focus (e.g., after publishing in designer tab)
    // or when a template is deleted/published programmatically
    window.addEventListener("focus", loadModules);
    window.addEventListener("workflowSidebarRefresh", loadModules);
    return () => {
      window.removeEventListener("focus", loadModules);
      window.removeEventListener("workflowSidebarRefresh", loadModules);
    };
  }, [session?.user]);

  const filteredItems = useMemo(() => {
    return navItems
      .filter((item) => item.href !== "/dashboard") // Dashboard rendered separately above workflow modules
      .map((item) => {
        if (!item.children) return item;
        const visibleChildren = item.children.filter((child) => can(child.permission));
        return { ...item, children: visibleChildren };
      })
      .filter((item) => {
        if (!can(item.permission)) return false;
        if (item.children && item.children.length === 0) return false;
        return true;
      });
  }, [can]);

  // Auto-expand sections that contain the active route
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of navItems) {
      if (item.children) {
        const hasActiveChild = item.children.some(
          (child) => pathname === child.href || pathname.startsWith(child.href.split("?")[0] + "/")
        );
        if (hasActiveChild || pathname === item.href || pathname.startsWith(item.href + "/")) {
          initial.add(item.label);
        }
      }
    }
    // Auto-expand active workflow module
    if (pathname.startsWith("/w/")) {
      const slug = pathname.split("/")[2];
      if (slug) initial.add(`wf:${slug}`);
    }
    return initial;
  });

  function toggleSection(label: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function isItemActive(href: string, hasChildren: boolean): boolean {
    if (hasChildren) return pathname.startsWith(href);
    return pathname === href;
  }

  function isChildActive(href: string): boolean {
    const base = href.split("?")[0];
    return pathname === base || pathname.startsWith(base + "/");
  }

  // The label shown in the sidebar footer (first role, or department fallback)
  const displayRole = userRoles[0] ?? session?.user?.department ?? "User";

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-20 flex-shrink-0">
          <Image
            src="/karu-logo-v2.png"
            alt="Karatina University"
            width={200}
            height={80}
            className="flex-shrink-0 h-14 w-auto"
          />
          <button
            onClick={onClose}
            className="ml-auto lg:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {/* Dashboard — always first */}
          {(() => {
            const dash = navItems.find((i) => i.href === "/dashboard");
            if (!dash) return null;
            const active = pathname === "/dashboard";
            return (
              <Link
                key="/dashboard"
                href="/dashboard"
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "text-karu-green bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <span className={active ? "text-karu-green" : "text-gray-400 dark:text-gray-500"}>{dash.icon}</span>
                <span>{dash.label}</span>
              </Link>
            );
          })()}

          {/* Dynamic workflow modules — directly below Dashboard */}
          {workflowModules.map((mod) => {
            const sectionKey = `wf:${mod.slug}`;
            const expanded = expandedSections.has(sectionKey);
            const base = `/w/${mod.slug}`;
            const active = pathname.startsWith(base);
            const instanceLabel = mod.instanceName ?? mod.name;

            const customViews: { label: string; href: string }[] = (mod.customQueries ?? []).map((v) => ({
              label: v.label,
              href: `${base}/view/${v.id}`,
            }));

            return (
              <div key={mod.slug}>
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "text-karu-green bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className={active ? "text-karu-green" : "text-gray-400 dark:text-gray-500"}>
                    <WorkflowModuleIcon name={mod.sidebarIcon ?? "document"} className="w-5 h-5" />
                  </span>
                  <span className="flex-1 text-left truncate">{mod.name}</span>
                  <ChevronIcon open={expanded} />
                </button>

                <div
                  className={`overflow-hidden transition-all duration-200 ${
                    expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <div className="ml-5 mt-1 space-y-0.5 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
                    {/* Core items */}
                    {[
                      { label: `New ${instanceLabel}`, href: `${base}/create` },
                      { label: "My Inbox", href: `${base}/inbox` },
                      { label: "Drafts", href: `${base}/drafts` },
                      { label: "Trace", href: `${base}/trace` },
                      { label: "Analytics", href: `${base}/analytics` },
                    ].map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                            childActive
                              ? "text-karu-green font-medium bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}
                        >
                          <span className="flex-1">{child.label}</span>
                        </Link>
                      );
                    })}
                    {/* Custom views — separated by a thin rule */}
                    {customViews.length > 0 && (
                      <>
                        <div className="h-px bg-gray-100 dark:bg-gray-800 mx-1 my-1" />
                        {customViews.map((child) => {
                          const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={onClose}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                childActive
                                  ? "text-karu-green font-medium bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                              }`}
                            >
                              <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 8.25h16.5" />
                              </svg>
                              <span className="flex-1">{child.label}</span>
                            </Link>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredItems.map((item) => {
            const hasChildren = !!item.children?.length;
            const active = isItemActive(item.href, hasChildren);
            const expanded = expandedSections.has(item.label);

            if (hasChildren) {
              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleSection(item.label)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "text-karu-green bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className={active ? "text-karu-green" : "text-gray-400 dark:text-gray-500"}>
                      {item.icon}
                    </span>
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronIcon open={expanded} />
                  </button>

                  <div
                    className={`overflow-hidden transition-all duration-200 ${
                      expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="ml-5 mt-1 space-y-0.5 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
                      {item.children!.map((child) => {
                        const childActive = isChildActive(child.href);
                        return (
                          <Link
                            key={child.href + child.label}
                            href={child.href}
                            onClick={onClose}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                              childActive
                                ? "text-karu-green font-medium bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                            }`}
                          >
                            <span className="flex-1">{child.label}</span>
                            {child.badge !== undefined && child.badge > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-karu-gold text-white text-xs font-semibold">
                                {child.badge}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "text-karu-green bg-karu-green-light dark:bg-karu-green/10 dark:text-karu-green"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <span className={active ? "text-karu-green" : "text-gray-400 dark:text-gray-500"}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 px-3 pb-3">
          {session?.user ? (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl">
              <UserInitials name={session.user.name ?? "U"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {session.user.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{displayRole}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                title="Sign out"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl animate-pulse">
              <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
