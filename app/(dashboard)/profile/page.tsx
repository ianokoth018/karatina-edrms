"use client";

import { useSession } from "next-auth/react";
import { useState, useMemo } from "react";
import Link from "next/link";

const RESOURCE_META: Record<string, { label: string; icon: string; color: string }> = {
  documents: { label: "Documents", icon: "📄", color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  workflows: { label: "Workflows", icon: "🔄", color: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-800" },
  records:   { label: "Records",   icon: "🗂️", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  forms:     { label: "Forms",     icon: "📝", color: "bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300 border-teal-200 dark:border-teal-800" },
  reports:   { label: "Reports",   icon: "📊", color: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
  admin:     { label: "Admin",     icon: "⚙️", color: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border-red-200 dark:border-red-800" },
};

const ACTION_LABELS: Record<string, string> = {
  create: "Create", read: "View", update: "Edit",
  delete: "Delete", approve: "Approve", manage: "Manage",
};

function groupPermissions(permissions: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of permissions) {
    const [resource, action] = p.split(":");
    if (!groups[resource]) groups[resource] = [];
    if (action) groups[resource].push(action);
  }
  return groups;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatRoleName(role: string): string {
  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type Tab = "overview" | "permissions" | "roles" | "account";

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);

  const user = session?.user;
  const permissionGroups = useMemo(
    () => groupPermissions(user?.permissions ?? []),
    [user?.permissions]
  );
  const isAdmin = user?.permissions?.includes("admin:manage") ?? false;

  function copyEmployeeId() {
    if (!user?.employeeId) return;
    navigator.clipboard.writeText(user.employeeId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-[#02773b]/20 border-t-[#02773b] animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400">Session not available.</p>
          <Link href="/auth/signin" className="mt-2 text-[#02773b] text-sm hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "permissions", label: "Permissions" },
    { id: "roles", label: "Roles" },
    { id: "account", label: "Account" },
  ];

  return (
    <div className="px-4 py-6 space-y-6">

      {/* Hero Card */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        {/* Banner */}
        <div className="relative h-32 bg-gradient-to-br from-[#02773b] to-[#014d28] overflow-hidden">
          {/* decorative circles */}
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5" />
          <div className="absolute -bottom-12 right-24 w-32 h-32 rounded-full bg-white/5" />
          <div className="absolute top-4 left-1/3 w-20 h-20 rounded-full bg-white/5" />
          {/* KARU watermark */}
          <span className="absolute bottom-3 right-5 text-white/10 font-black text-5xl tracking-widest select-none">
            KARU
          </span>
          {isAdmin && (
            <span className="absolute top-3 right-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#dd9f42]/90 text-white text-xs font-semibold shadow">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.664 1.319a.75.75 0 0 1 .672 0 41.059 41.059 0 0 1 8.198 5.424.75.75 0 0 1-.254 1.285 31.372 31.372 0 0 0-7.86 3.83.75.75 0 0 1-.84 0 31.508 31.508 0 0 0-2.08-1.287V9.394c0-.244.116-.463.302-.592a35.504 35.504 0 0 1 3.305-2.033.75.75 0 0 0-.714-1.319 37 37 0 0 0-3.446 2.12A2.216 2.216 0 0 0 6 9.393v.38a31.293 31.293 0 0 0-4.28-1.746.75.75 0 0 1-.254-1.285 41.059 41.059 0 0 1 8.198-5.424ZM6 11.459a29.848 29.848 0 0 0-2.455-1.158 41.029 41.029 0 0 0-.39 3.114.75.75 0 0 0 .419.74c.528.256 1.046.53 1.554.82-.21.324-.455.63-.739.914a.75.75 0 1 0 1.06 1.06c.37-.369.69-.77.96-1.193a26.61 26.61 0 0 1 3.095 2.348.75.75 0 0 0 .992 0 26.547 26.547 0 0 1 5.93-3.95.75.75 0 0 0 .42-.739 41.053 41.053 0 0 0-.39-3.114 29.925 29.925 0 0 0-5.199 2.801 2.25 2.25 0 0 1-2.514 0c-.41-.275-.826-.541-1.25-.796v-.086Z" clipRule="evenodd" />
              </svg>
              Administrator
            </span>
          )}
        </div>

        {/* Avatar + Info */}
        <div className="px-6 pb-6">
          {/* Avatar - overlaps the banner */}
          <div className="-mt-10 mb-3">
            <div className="relative w-20 h-20 shrink-0">
              <div className="w-20 h-20 rounded-full ring-4 ring-white dark:ring-gray-900 bg-gradient-to-br from-[#02773b] to-[#014d28] flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-2xl">{getInitials(user.name ?? "U")}</span>
              </div>
              <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-400 border-2 border-white dark:border-gray-900" title="Online" />
            </div>
          </div>
          {/* Name — clearly in white card area */}
          <div className="mb-4">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{user.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{user.jobTitle || "—"}</p>
          </div>

          {/* Quick chips */}
          <div className="flex flex-wrap gap-2">
            {user.department && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f0fdf4] dark:bg-[#052e16] text-[#02773b] dark:text-[#60c988] text-xs font-medium border border-[#02773b]/20">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                </svg>
                {user.department}
              </span>
            )}
            {user.employeeId && (
              <button
                onClick={copyEmployeeId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="Click to copy"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
                {copied ? "Copied!" : `ID: ${user.employeeId}`}
              </button>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium border border-gray-200 dark:border-gray-700">
              {user.permissions?.length ?? 0} permissions
            </span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? "bg-white dark:bg-gray-900 text-[#02773b] dark:text-[#60c988] shadow-sm border border-gray-200 dark:border-gray-700"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Department</p>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">{user.department || "—"}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Job Title</p>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">{user.jobTitle || "—"}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Assigned Roles</p>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">{user.roles?.length ?? 0}</p>
            </div>
          </div>

          {/* Personal Info Card */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Personal Information</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {[
                { label: "Full Name", value: user.name },
                { label: "Email Address", value: user.email },
                { label: "Employee ID", value: user.employeeId },
                { label: "Department", value: user.department },
                { label: "Job Title", value: user.jobTitle },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-32 shrink-0">{label}</span>
                  <span className="text-sm text-gray-900 dark:text-white font-medium text-right truncate ml-2">
                    {value || <span className="text-gray-400">—</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Permissions */}
      {activeTab === "permissions" && (
        <div className="space-y-4">
          {Object.keys(permissionGroups).length === 0 ? (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
              <p className="text-gray-400 dark:text-gray-500 text-sm">No permissions assigned.</p>
            </div>
          ) : (
            Object.entries(permissionGroups).map(([resource, actions]) => {
              const meta = RESOURCE_META[resource] ?? {
                label: resource.charAt(0).toUpperCase() + resource.slice(1),
                icon: "🔑",
                color: "bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
              };
              return (
                <div
                  key={resource}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-xl">{meta.icon}</span>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{meta.label}</h3>
                    <span className="ml-auto text-xs text-gray-400">{actions.length} action{actions.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="px-5 py-4 flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <span
                        key={action}
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${meta.color}`}
                      >
                        {ACTION_LABELS[action] ?? action}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab: Roles */}
      {activeTab === "roles" && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Assigned Roles</h2>
            <p className="text-xs text-gray-400 mt-0.5">Roles define your access level within the system.</p>
          </div>
          {!user.roles || user.roles.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-gray-400 text-sm">No roles assigned.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {user.roles.map((role) => (
                <div key={role} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#f0fdf4] dark:bg-[#052e16] flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#02773b] dark:text-[#60c988]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatRoleName(role)}</p>
                      <p className="text-xs text-gray-400">{role}</p>
                    </div>
                  </div>
                  {role.toLowerCase().includes("admin") && (
                    <span className="px-2.5 py-1 rounded-full bg-[#dd9f42]/10 text-[#dd9f42] text-xs font-semibold border border-[#dd9f42]/20">
                      Admin
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Account */}
      {activeTab === "account" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Account Details</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {[
                { label: "Email", value: user.email },
                { label: "Employee ID", value: user.employeeId },
                { label: "Account ID", value: user.id },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-32 shrink-0">{label}</span>
                  <span className="text-sm text-gray-900 dark:text-white font-mono text-right truncate ml-2 max-w-xs">
                    {value || <span className="font-sans text-gray-400">—</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Security */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Security</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Password</p>
                  <p className="text-xs text-gray-400 mt-0.5">Change your account password</p>
                </div>
                <Link
                  href="/auth/reset-password"
                  className="text-xs font-medium text-[#02773b] dark:text-[#60c988] hover:underline"
                >
                  Change
                </Link>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Two-Factor Authentication</p>
                  <p className="text-xs text-gray-400 mt-0.5">Add an extra layer of security</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs font-medium">
                  Coming soon
                </span>
              </div>
            </div>
          </div>

          {/* Sign out */}
          <div className="rounded-2xl border border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Sign out</p>
              <p className="text-xs text-red-500/70 dark:text-red-500/60 mt-0.5">Sign out from all sessions</p>
            </div>
            <Link
              href="/auth/signout"
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
            >
              Sign out
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
