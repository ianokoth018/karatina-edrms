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
  isActive: boolean;
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
  const [formRoleIds, setFormRoleIds] = useState<string[]>([]);

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
    setFormRoleIds(user.roles.map((r) => r.role.id));
    setFormError(null);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      if (editUser) {
        // PATCH update
        const res = await fetch(`/api/admin/users/${editUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            email: formEmail,
            department: formDepartment || null,
            roleIds: formRoleIds,
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
            department: formDepartment || null,
            roleIds: formRoleIds,
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
                      {user.department ?? "-"}
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
    </div>
  );
}
