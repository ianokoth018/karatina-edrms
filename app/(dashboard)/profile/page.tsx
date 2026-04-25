"use client";

import { useSession } from "next-auth/react";
import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import SignaturePanel from "@/components/profile/signature-panel";

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
  const { data: session, status, update } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);

  // Profile photo state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const user = session?.user;

  // Set initial photo URL when session loads (cache-busted via session refresh)
  useEffect(() => {
    if (user?.id && user.profilePhoto) {
      setPhotoUrl(`/api/profile/photo/${user.id}?v=${user.profilePhoto.length}`);
    } else {
      setPhotoUrl(null);
    }
  }, [user?.id, user?.profilePhoto]);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file (PNG, JPEG, WebP, or GIF).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setPhotoError("Maximum file size is 4 MiB.");
      return;
    }

    setPhotoError(null);
    setPhotoBusy(true);

    // Optimistic preview
    const localPreview = URL.createObjectURL(file);
    setPhotoUrl(localPreview);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/profile/photo", {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        const data = await res.json();
        setPhotoUrl(data.url);
        await update();
      } else {
        const err = await res.json().catch(() => null);
        setPhotoError(err?.error ?? "Upload failed");
        // Revert preview on error
        setPhotoUrl(
          user?.profilePhoto && user.id
            ? `/api/profile/photo/${user.id}?v=${user.profilePhoto.length}`
            : null
        );
      }
    } catch {
      setPhotoError("Network error");
    } finally {
      setPhotoBusy(false);
      URL.revokeObjectURL(localPreview);
    }
  }

  async function handleRemovePhoto() {
    if (!confirm("Remove your profile photo?")) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/profile/photo", { method: "DELETE" });
      if (res.ok) {
        setPhotoUrl(null);
        await update();
      } else {
        const err = await res.json().catch(() => null);
        setPhotoError(err?.error ?? "Remove failed");
      }
    } catch {
      setPhotoError("Network error");
    } finally {
      setPhotoBusy(false);
    }
  }
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
          {/* Avatar - overlaps the banner. Click to upload a photo. */}
          <div className="-mt-10 mb-3">
            <div className="relative w-20 h-20 shrink-0 group">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoBusy}
                title="Change photo"
                className="block w-20 h-20 rounded-full ring-4 ring-white dark:ring-gray-900 overflow-hidden bg-gradient-to-br from-[#02773b] to-[#014d28] shadow-lg relative focus:outline-none focus:ring-[#dd9f42] disabled:cursor-wait"
              >
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl}
                    alt={user.name ?? "Profile"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-2xl">
                    {getInitials(user.name ?? "U")}
                  </span>
                )}
                {/* Hover overlay with camera icon */}
                <span
                  className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                    photoBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {photoBusy ? (
                    <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.823-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.823 1.316Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                    </svg>
                  )}
                </span>
              </button>
              {!photoBusy && (
                <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-400 border-2 border-white dark:border-gray-900" title="Online" />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handlePhotoSelect}
                className="sr-only"
              />
            </div>
            {(photoError || photoUrl) && (
              <div className="mt-2 flex items-center gap-3 text-xs">
                {photoError ? (
                  <span className="text-red-600 dark:text-red-400">{photoError}</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={photoBusy}
                      className="text-[#02773b] dark:text-[#60c988] hover:underline font-medium"
                    >
                      Change photo
                    </button>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        disabled={photoBusy}
                        className="text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {!photoUrl && !photoError && !photoBusy && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 text-xs text-[#02773b] dark:text-[#60c988] hover:underline font-medium"
              >
                Upload a photo
              </button>
            )}
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

          {/* Signature & office stamp */}
          <SignaturePanel userId={user.id} />

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
                  href="/change-password"
                  className="text-xs font-medium text-[#02773b] dark:text-[#60c988] hover:underline"
                >
                  Change
                </Link>
              </div>
              <MfaSection />
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

/* ------------------------------------------------------------------ */
/*  MFA setup / disable section (used inside the Account tab)         */
/* ------------------------------------------------------------------ */

function MfaSection() {
  const { data: session, update } = useSession();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loadingState, setLoadingState] = useState(true);
  const [stage, setStage] = useState<"idle" | "verify">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string>("");
  const [code, setCode] = useState("");
  const [disablePw, setDisablePw] = useState("");

  // Fetch current MFA status on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${session?.user?.id}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setMfaEnabled(!!data.user?.mfaEnabled);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Failed to send code");
      } else {
        setMaskedEmail(data?.maskedEmail ?? "your email");
        setStage("verify");
        setInfo(`A 6-digit code has been sent to ${data?.maskedEmail ?? "your email"}.`);
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  async function confirmSetup() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setError(e?.error ?? "Verification failed");
      } else {
        setMfaEnabled(true);
        setStage("idle");
        setCode("");
        setInfo("Email Two-Factor Authentication is now enabled.");
        await update();
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePw }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setError(e?.error ?? "Disable failed");
      } else {
        setMfaEnabled(false);
        setStage("idle");
        setDisablePw("");
        setInfo("Two-Factor Authentication has been disabled.");
        await update();
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Two-Factor Authentication
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Email a 6-digit code to your inbox each time you sign in.
          </p>
        </div>
        {loadingState ? (
          <span className="text-xs text-gray-400">Loading…</span>
        ) : mfaEnabled ? (
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            Enabled
          </span>
        ) : (
          <button
            type="button"
            onClick={startSetup}
            disabled={busy}
            className="text-xs font-medium text-[#02773b] dark:text-[#60c988] hover:underline disabled:opacity-50"
          >
            {busy ? "Sending…" : "Enable"}
          </button>
        )}
      </div>

      {/* Verify stage — code entry */}
      {stage === "verify" && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3 bg-gray-50 dark:bg-gray-800/40">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Enter the 6-digit code sent to <strong>{maskedEmail}</strong> to
            confirm Two-Factor Authentication. The code is valid for 10 minutes.
          </p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
            className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-sm font-mono tracking-[0.4em] focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStage("idle");
                setCode("");
                setError(null);
                setInfo(null);
              }}
              className="px-3 h-9 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={startSetup}
              disabled={busy}
              className="px-3 h-9 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Resend code
            </button>
            <button
              type="button"
              onClick={confirmSetup}
              disabled={busy || code.length < 6}
              className="px-3 h-9 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Confirm & enable"}
            </button>
          </div>
        </div>
      )}

      {/* Disable controls when MFA is on */}
      {mfaEnabled && stage === "idle" && (
        <details className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-gray-50 dark:bg-gray-800/40">
          <summary className="text-xs font-medium text-red-600 dark:text-red-400 cursor-pointer">
            Disable Two-Factor Authentication
          </summary>
          <div className="mt-3 space-y-2">
            <input
              type="password"
              value={disablePw}
              onChange={(e) => setDisablePw(e.target.value)}
              placeholder="Confirm with your password"
              className="w-full h-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-sm focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none"
            />
            <button
              type="button"
              onClick={disable}
              disabled={busy || !disablePw}
              className="px-3 h-9 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Disabling…" : "Disable two-factor authentication"}
            </button>
          </div>
        </details>
      )}

      {info && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {info}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
