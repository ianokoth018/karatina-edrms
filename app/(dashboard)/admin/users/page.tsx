"use client";

import { useState, useEffect, useCallback } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface UserRole {
  role: { id: string; name: string };
}

interface User {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  designation: string | null;
  phone: string | null;
  employeeId: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  passwordResetExpiresAt?: string | null;
  mfaEnabled?: boolean;
  lockedUntil?: string | null;
  failedLoginAttempts?: number;
  lastLoginAt: string | null;
  createdAt: string;
  roles: UserRole[];
}

interface Role {
  id: string;
  name: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const { can } = usePermissions();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [formJobTitle, setFormJobTitle] = useState("");
  const [formDesignation, setFormDesignation] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formRoleIds, setFormRoleIds] = useState<string[]>([]);

  // Password-reset modal state
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetNote, setResetNote] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{
    otp: string;
    validityHours: number;
    emailSent: boolean;
  } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [otpCopied, setOtpCopied] = useState(false);

  const fetchUsers = useCallback(
    async (page = 1, searchQuery = search) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (searchQuery) params.set("search", searchQuery);

        const res = await fetch(`/api/admin/users?${params}`);
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users);
          setPagination(data.pagination);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [search]
  );

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roles");
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, [fetchUsers, fetchRoles]);

  function openAddModal() {
    setEditUser(null);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setFormDepartment("");
    setFormJobTitle("");
    setFormDesignation("");
    setFormPhone("");
    setFormEmployeeId("");
    setFormRoleIds([]);
    setFormError(null);
    setShowModal(true);
  }

  function openEditModal(user: User) {
    setEditUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword("");
    setFormDepartment(user.department ?? "");
    setFormJobTitle(user.jobTitle ?? "");
    setFormDesignation(user.designation ?? "");
    setFormPhone(user.phone ?? "");
    setFormEmployeeId(user.employeeId ?? "");
    setFormRoleIds(user.roles.map((r) => r.role.id));
    setFormError(null);
    setShowModal(true);
  }

  function openResetModal(user: User) {
    setResetUser(user);
    setResetNote("");
    setResetResult(null);
    setResetError(null);
    setOtpCopied(false);
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(
        `/api/admin/users/${resetUser.id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: resetNote || undefined }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setResetResult({
          otp: data.otp,
          validityHours: data.validityHours,
          emailSent: !!data.emailSent,
        });
        fetchUsers(pagination.page);
      } else {
        const data = await res.json().catch(() => null);
        setResetError(data?.error ?? "Reset failed");
      }
    } catch {
      setResetError("Network error");
    } finally {
      setResetting(false);
    }
  }

  async function handleUnlock(user: User) {
    if (!confirm(`Unlock ${user.displayName}'s account?`)) return;
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlock: true }),
      });
      fetchUsers(pagination.page);
    } catch {
      /* ignore */
    }
  }

  async function copyOtpToClipboard() {
    if (!resetResult?.otp) return;
    try {
      await navigator.clipboard.writeText(resetResult.otp);
      setOtpCopied(true);
      setTimeout(() => setOtpCopied(false), 2000);
    } catch {
      /* clipboard blocked — admin can still read the OTP */
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const sharedFields = {
        department: formDepartment || null,
        jobTitle: formJobTitle || null,
        designation: formDesignation || null,
        phone: formPhone || null,
        employeeId: formEmployeeId || null,
      };
      if (editUser) {
        // PATCH update
        const res = await fetch(`/api/admin/users/${editUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            email: formEmail,
            roleIds: formRoleIds,
            ...sharedFields,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to update user");
          return;
        }
      } else {
        // POST create
        if (!formPassword) {
          setFormError("Password is required for new users");
          return;
        }
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            email: formEmail,
            password: formPassword,
            roleIds: formRoleIds,
            ...sharedFields,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to create user");
          return;
        }
      }
      setShowModal(false);
      fetchUsers(pagination.page);
    } catch {
      setFormError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: User) {
    try {
      if (user.isActive) {
        await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      } else {
        await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        });
      }
      fetchUsers(pagination.page);
    } catch {
      // silently fail
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchUsers(1, search);
  }

  function toggleRole(roleId: string) {
    setFormRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    );
  }

  const hasPermission = can("admin:manage");

  if (!hasPermission) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to access user management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            User Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage system users, roles and access
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Add User
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="max-w-md">
        <div className="relative">
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
        </div>
      </form>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Email
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Department
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Roles
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Last Login
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-karu-green flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                          {user.displayName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {user.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {user.email}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 hidden md:table-cell">
                      <div className="flex flex-col">
                        <span>{user.designation ?? user.jobTitle ?? "—"}</span>
                        {user.department && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                            {user.department}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((ur) => (
                          <span
                            key={ur.role.id}
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-karu-green-light dark:bg-karu-green/10 text-karu-green text-xs font-medium"
                          >
                            {ur.role.name}
                          </span>
                        ))}
                        {user.roles.length === 0 && (
                          <span className="text-gray-400 text-xs">
                            No roles
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${
                            user.isActive
                              ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                              : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              user.isActive ? "bg-green-500" : "bg-red-500"
                            }`}
                          />
                          {user.isActive ? "Active" : "Inactive"}
                        </span>
                        {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                          <span
                            title={`Locked until ${new Date(user.lockedUntil).toLocaleString("en-GB")}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                            </svg>
                            Locked
                          </span>
                        )}
                        {user.mfaEnabled && (
                          <span
                            title="Multi-factor authentication enabled"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                            </svg>
                            MFA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString(
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
                          title="Edit"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => openResetModal(user)}
                          disabled={!user.isActive}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title={user.isActive ? "Reset password (issue OTP)" : "Reactivate user before resetting password"}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                          </svg>
                        </button>
                        {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                          <button
                            onClick={() => handleUnlock(user)}
                            className="p-1.5 rounded-lg text-amber-600 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                            title="Unlock account (clear failed attempts)"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => toggleActive(user)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            user.isActive
                              ? "text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              : "text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                          }`}
                          title={
                            user.isActive ? "Deactivate" : "Activate"
                          }
                        >
                          {user.isActive ? (
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                              />
                            </svg>
                          ) : (
                            <svg
                              className="w-4 h-4"
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
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => fetchUsers(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => fetchUsers(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {editUser ? "Edit User" : "Add User"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {formError}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Email
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  required
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                />
              </div>

              {!editUser && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Password
                  </label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    required={!editUser}
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formDepartment}
                    onChange={(e) => setFormDepartment(e.target.value)}
                    placeholder="e.g. Registry, Finance, ICT"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={formDesignation}
                    onChange={(e) => setFormDesignation(e.target.value)}
                    placeholder="e.g. Vice Chancellor, Head of Department"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                  <p className="text-[11px] text-gray-400">Used on memos &amp; signatures</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Job title
                  </label>
                  <input
                    type="text"
                    value={formJobTitle}
                    onChange={(e) => setFormJobTitle(e.target.value)}
                    placeholder="e.g. Senior Lecturer, Records Officer"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+254 7XX XXX XXX"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    value={formEmployeeId}
                    onChange={(e) => setFormEmployeeId(e.target.value)}
                    placeholder="e.g. KU-EMP-12345 (optional)"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Roles
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl p-3">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formRoleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/20"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {role.name}
                      </span>
                    </label>
                  ))}
                  {roles.length === 0 && (
                    <p className="text-sm text-gray-400">No roles available</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && (
                    <svg
                      className="animate-spin h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {editUser ? "Save Changes" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password reset modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Reset password for {resetUser.displayName}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {resetUser.email}
                </p>
              </div>
              <button
                onClick={() => {
                  setResetUser(null);
                  setResetResult(null);
                  setResetError(null);
                }}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!resetResult ? (
                <>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    <span>
                      This will <strong>replace the user&apos;s password</strong> with a one-time
                      password. They will be prompted to set a new password on next login.
                      The OTP is also emailed to <strong>{resetUser.email}</strong>.
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                      Note for the user (optional)
                    </label>
                    <textarea
                      value={resetNote}
                      onChange={(e) => setResetNote(e.target.value)}
                      rows={3}
                      placeholder="e.g. Resetting after the SSO migration — please pick a strong personal password."
                      className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
                    />
                  </div>
                  {resetError && (
                    <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                      {resetError}
                    </div>
                  )}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setResetUser(null)}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      disabled={resetting}
                      className="px-4 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-60"
                    >
                      {resetting ? "Resetting…" : "Reset password & email OTP"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                    Password reset.{" "}
                    {resetResult.emailSent
                      ? `An email with the OTP was sent to ${resetUser.email}.`
                      : "SMTP isn't configured (or delivery failed) — share the OTP below directly with the user."}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">
                      One-time password
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-lg font-bold tracking-[0.3em] text-karu-green text-center">
                        {resetResult.otp}
                      </code>
                      <button
                        type="button"
                        onClick={copyOtpToClipboard}
                        className="px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        {otpCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">
                      Valid for {resetResult.validityHours} hour
                      {resetResult.validityHours === 1 ? "" : "s"}. The user
                      will be required to set a new password on first login.
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setResetUser(null);
                        setResetResult(null);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
