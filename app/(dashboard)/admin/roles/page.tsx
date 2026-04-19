"use client";

import { useState, useEffect, useCallback } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface Permission {
  id: string;
  resource: string;
  action: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  _count: { users: number };
}

const RESOURCES = [
  "memos",
  "correspondence",
  "documents",
  "workflows",
  "records",
  "records_casefolders",
  "records_classification",
  "records_retention",
  "records_physical",
  "records_disposition",
  "records_capture",
  "forms",
  "reports",
  "admin",
];

// Resources that are sub-modules of a parent — indented in the UI
const SUB_RESOURCES: Record<string, string> = {
  records_casefolders:   "records",
  records_classification:"records",
  records_retention:     "records",
  records_physical:      "records",
  records_disposition:   "records",
  records_capture:       "records",
};

const RESOURCE_LABELS: Record<string, string> = {
  records_casefolders:    "↳ Casefolders",
  records_classification: "↳ Classification",
  records_retention:      "↳ Retention",
  records_physical:       "↳ Physical Records",
  records_disposition:    "↳ Disposition",
  records_capture:        "↳ Auto Capture",
};
const ACTIONS = ["create", "read", "update", "delete", "approve", "manage"];

export default function RolesPage() {
  const { can } = usePermissions();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPermissions, setFormPermissions] = useState<
    Set<string>
  >(new Set());

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles");
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  function openCreateModal() {
    setEditRole(null);
    setFormName("");
    setFormDescription("");
    setFormPermissions(new Set());
    setFormError(null);
    setShowModal(true);
  }

  function openEditModal(role: Role) {
    setEditRole(role);
    setFormName(role.name);
    setFormDescription(role.description ?? "");
    setFormPermissions(
      new Set(role.permissions.map((p) => `${p.resource}:${p.action}`))
    );
    setFormError(null);
    setShowModal(true);
  }

  function togglePermission(resource: string, action: string) {
    const key = `${resource}:${action}`;
    setFormPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAllForResource(resource: string) {
    const allKeys = ACTIONS.map((a) => `${resource}:${a}`);
    const allChecked = allKeys.every((k) => formPermissions.has(k));

    setFormPermissions((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        allKeys.forEach((k) => next.delete(k));
      } else {
        allKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const permissions = Array.from(formPermissions).map((p) => {
      const [resource, action] = p.split(":");
      return { resource, action };
    });

    try {
      if (editRole) {
        const res = await fetch(`/api/admin/roles/${editRole.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            description: formDescription || null,
            permissions,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to update role");
          return;
        }
      } else {
        if (!formName) {
          setFormError("Role name is required");
          return;
        }
        const res = await fetch("/api/admin/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            description: formDescription || null,
            permissions,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to create role");
          return;
        }
      }
      setShowModal(false);
      fetchRoles();
    } catch {
      setFormError("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: Role) {
    if (
      !confirm(
        `Are you sure you want to delete the role "${role.name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeleting(role.id);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete role");
        return;
      }
      fetchRoles();
    } catch {
      alert("An unexpected error occurred");
    } finally {
      setDeleting(null);
    }
  }

  const hasPermission = can("admin:manage");

  if (!hasPermission) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to access role management.
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
            Role Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Define roles and their permissions
          </p>
        </div>
        <button
          onClick={openCreateModal}
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
          Create Role
        </button>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse"
              >
                <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
                <div className="flex gap-4">
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              </div>
            ))
          : roles.map((role) => (
              <div
                key={role.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      {role.name}
                    </h3>
                    {role.isSystem && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-karu-gold-light dark:bg-karu-gold/10 text-karu-gold">
                        System
                      </span>
                    )}
                  </div>
                  {role.name !== "ADMIN" && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEditModal(role)}
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
                        onClick={() => handleDelete(role)}
                        disabled={deleting === role.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        title="Delete"
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
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {role.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    {role.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                      />
                    </svg>
                    {role.permissions.length} permissions
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                      />
                    </svg>
                    {role._count.users} users
                  </span>
                </div>
              </div>
            ))}
      </div>

      {/* Permission editing modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {editRole ? `Edit Role: ${editRole.name}` : "Create Role"}
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

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {formError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {formError}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Role Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    placeholder="e.g. RECORDS_MANAGER"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />
                </div>
              </div>

              {/* Permission grid */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Permissions
                </h3>
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                          Resource
                        </th>
                        {ACTIONS.map((action) => (
                          <th
                            key={action}
                            className="text-center px-2 py-2.5 font-medium text-gray-500 dark:text-gray-400 capitalize"
                          >
                            {action}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {RESOURCES.map((resource) => {
                        const allChecked = ACTIONS.every((a) =>
                          formPermissions.has(`${resource}:${a}`)
                        );
                        const isSub = resource in SUB_RESOURCES;
                        const label = RESOURCE_LABELS[resource] ?? resource;
                        return (
                          <tr
                            key={resource}
                            className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${isSub ? "bg-gray-50/50 dark:bg-gray-800/20" : ""}`}
                          >
                            <td className={`py-2.5 ${isSub ? "pl-8 pr-4" : "px-4"}`}>
                              <button
                                type="button"
                                onClick={() =>
                                  toggleAllForResource(resource)
                                }
                                className={`text-sm transition-colors ${
                                  isSub
                                    ? "font-normal text-gray-500 dark:text-gray-400"
                                    : "font-medium capitalize"
                                } ${allChecked ? "text-karu-green" : isSub ? "text-gray-500 dark:text-gray-400" : "text-gray-700 dark:text-gray-300"}`}
                              >
                                {label}
                              </button>
                            </td>
                            {ACTIONS.map((action) => (
                              <td
                                key={action}
                                className="text-center px-2 py-2.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={formPermissions.has(
                                    `${resource}:${action}`
                                  )}
                                  onChange={() =>
                                    togglePermission(resource, action)
                                  }
                                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/20"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Click a resource name to toggle all actions for it.{" "}
                  {formPermissions.size} permission(s) selected.
                </p>
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
                  {editRole ? "Save Changes" : "Create Role"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
