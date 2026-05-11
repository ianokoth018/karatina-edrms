"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

interface PoolMember {
  id: string;
  userId: string;
  joinedAt: string;
  user: { id: string; name: string; displayName: string | null; email: string; department: string | null };
}

interface Pool {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: PoolMember[];
  _count: { tasks: number };
}

interface UserSearchResult {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  department: string | null;
  jobTitle?: string | null;
}

interface Department {
  name: string;
  userCount: number;
}

interface RoleOption {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
}

function fmtRole(name: string): string {
  return name.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

function IconSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function UserRow({
  u,
  alreadyMember,
  addingMember,
  onAdd,
}: {
  u: UserSearchResult;
  alreadyMember: boolean;
  addingMember: string | null;
  onAdd: (id: string) => void;
}) {
  return (
    <button
      onClick={() => !alreadyMember && onAdd(u.id)}
      disabled={alreadyMember || addingMember === u.id}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-0 ${alreadyMember ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center text-[10px] font-bold text-[#02773b] dark:text-emerald-400 shrink-0">
          {(u.displayName ?? u.name).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{u.displayName ?? u.name}</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {u.jobTitle ? `${u.jobTitle} · ` : ""}{u.email}
          </p>
        </div>
      </div>
      {addingMember === u.id ? (
        <IconSpinner className="w-3.5 h-3.5 text-[#02773b] shrink-0" />
      ) : alreadyMember ? (
        <span className="text-[10px] text-gray-400 shrink-0">Added</span>
      ) : (
        <span className="text-[10px] font-semibold text-[#02773b] dark:text-emerald-400 shrink-0">+ Add</span>
      )}
    </button>
  );
}

export default function PoolsPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Create pool modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit pool modal
  const [editPool, setEditPool] = useState<Pool | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Add member modal
  const [addMemberPool, setAddMemberPool] = useState<Pool | null>(null);
  const [addMemberTab, setAddMemberTab] = useState<"department" | "role" | "all">("department");
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  // Department tab
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptQuery, setDeptQuery] = useState("");
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [deptUsers, setDeptUsers] = useState<UserSearchResult[]>([]);
  const [deptUserQuery, setDeptUserQuery] = useState("");
  const [loadingDeptUsers, setLoadingDeptUsers] = useState(false);
  // Role tab
  const [rolesList, setRolesList] = useState<RoleOption[]>([]);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleUsers, setRoleUsers] = useState<UserSearchResult[]>([]);
  const [roleUserQuery, setRoleUserQuery] = useState("");
  const [loadingRoleUsers, setLoadingRoleUsers] = useState(false);
  // All users tab
  const [allUserQuery, setAllUserQuery] = useState("");
  const [allUserResults, setAllUserResults] = useState<UserSearchResult[]>([]);
  const [searchingAll, setSearchingAll] = useState(false);
  // Bulk add
  const [addingAll, setAddingAll] = useState(false);
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  // Delete confirmation
  const [deletePool, setDeletePool] = useState<Pool | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows/pools");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPools(data.pools ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load departments + roles when modal opens
  useEffect(() => {
    if (!addMemberPool) return;
    fetch("/api/users/search?departments=true")
      .then(r => r.json())
      .then(data => setDepartments(data.departments ?? []));
    fetch("/api/users/search?roles=true")
      .then(r => r.json())
      .then(data => setRolesList(data.roles ?? []));
  }, [addMemberPool]);

  // Load users when a role is selected
  useEffect(() => {
    if (!selectedRole) { setRoleUsers([]); return; }
    setLoadingRoleUsers(true);
    fetch(`/api/users/search?role=${encodeURIComponent(selectedRole)}&limit=200`)
      .then(r => r.json())
      .then(data => setRoleUsers(data.users ?? []))
      .finally(() => setLoadingRoleUsers(false));
  }, [selectedRole]);

  // Load users when department is selected
  useEffect(() => {
    if (!selectedDept) { setDeptUsers([]); return; }
    setLoadingDeptUsers(true);
    fetch(`/api/users/search?department=${encodeURIComponent(selectedDept)}&limit=50`)
      .then(r => r.json())
      .then(data => setDeptUsers(data.users ?? []))
      .finally(() => setLoadingDeptUsers(false));
  }, [selectedDept]);

  // All-users tab debounced search
  useEffect(() => {
    if (allUserQuery.length < 2) { setAllUserResults([]); return; }
    const t = setTimeout(() => {
      setSearchingAll(true);
      fetch(`/api/users/search?q=${encodeURIComponent(allUserQuery)}&limit=20`)
        .then(r => r.json())
        .then(data => setAllUserResults(data.users ?? []))
        .finally(() => setSearchingAll(false));
    }, 250);
    return () => clearTimeout(t);
  }, [allUserQuery]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        setDeptDropdownOpen(false);
      }
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setRoleDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredDepts = useMemo(() => {
    if (!deptQuery.trim()) return departments;
    const q = deptQuery.toLowerCase();
    return departments.filter(d => d.name.toLowerCase().includes(q));
  }, [departments, deptQuery]);

  const filteredDeptUsers = useMemo(() => {
    if (!deptUserQuery.trim()) return deptUsers;
    const q = deptUserQuery.toLowerCase();
    return deptUsers.filter(u =>
      (u.displayName ?? u.name).toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.jobTitle ?? "").toLowerCase().includes(q)
    );
  }, [deptUsers, deptUserQuery]);

  const filteredRoles = useMemo(() => {
    if (!roleQuery.trim()) return rolesList;
    const q = roleQuery.toLowerCase();
    return rolesList.filter(r => r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
  }, [rolesList, roleQuery]);

  const filteredRoleUsers = useMemo(() => {
    if (!roleUserQuery.trim()) return roleUsers;
    const q = roleUserQuery.toLowerCase();
    return roleUsers.filter(u =>
      (u.displayName ?? u.name).toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.jobTitle ?? "").toLowerCase().includes(q)
    );
  }, [roleUsers, roleUserQuery]);

  function closeAddModal() {
    setAddMemberPool(null);
    setAddMemberTab("department");
    setDepartments([]);
    setDeptQuery("");
    setDeptDropdownOpen(false);
    setSelectedDept(null);
    setDeptUsers([]);
    setDeptUserQuery("");
    setRolesList([]);
    setRoleQuery("");
    setRoleDropdownOpen(false);
    setSelectedRole(null);
    setRoleUsers([]);
    setRoleUserQuery("");
    setAllUserQuery("");
    setAllUserResults([]);
    setMemberError(null);
  }

  async function addAllMembers(users: UserSearchResult[]) {
    if (!addMemberPool) return;
    const toAdd = users.filter(u => !addMemberPool.members.some(m => m.userId === u.id));
    if (toAdd.length === 0) return;
    setAddingAll(true);
    try {
      await Promise.all(
        toAdd.map(u =>
          fetch(`/api/workflows/pools/${addMemberPool.id}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: u.id }),
          })
        )
      );
      await load();
      const updated = await fetch(`/api/workflows/pools/${addMemberPool.id}`).then(r => r.json());
      setAddMemberPool(updated.pool ?? null);
    } finally {
      setAddingAll(false);
    }
  }

  async function createPool() {
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/workflows/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), description: createDesc.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "Failed to create"); return; }
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit() {
    if (!editPool) return;
    setSaving(true);
    try {
      await fetch(`/api/workflows/pools/${editPool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
      });
      setEditPool(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function addMember(userId: string) {
    if (!addMemberPool) return;
    setAddingMember(userId);
    setMemberError(null);
    try {
      const res = await fetch(`/api/workflows/pools/${addMemberPool.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) { setMemberError(data.error ?? "Failed to add"); return; }
      await load();
      const updated = await fetch(`/api/workflows/pools/${addMemberPool.id}`).then(r => r.json());
      setAddMemberPool(updated.pool ?? null);
    } finally {
      setAddingMember(null);
    }
  }

  async function removeMember(poolId: string, userId: string) {
    await fetch(`/api/workflows/pools/${poolId}/members?userId=${userId}`, { method: "DELETE" });
    await load();
    if (addMemberPool?.id === poolId) {
      const updated = await fetch(`/api/workflows/pools/${poolId}`).then(r => r.json());
      setAddMemberPool(updated.pool ?? null);
    }
  }

  async function confirmDelete() {
    if (!deletePool) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflows/pools/${deletePool.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "Cannot delete pool"); return; }
      setDeletePool(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const inputCls = "w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#02773b]/50";

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Workflow Pools</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Shared task queues — members can claim any unclaimed task in their pool</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            New Pool
          </button>
        </div>

        {/* Pool list */}
        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950" />)}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button onClick={load} className="mt-3 text-sm text-[#02773b] hover:underline">Retry</button>
          </div>
        ) : pools.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-12 text-center">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">No pools yet</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Create a pool and add members to enable shared task queues in your workflows.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pools.map(pool => {
              const isExpanded = expanded === pool.id;
              return (
                <div key={pool.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
                  <div className="h-0.5 bg-gradient-to-r from-[#02773b] to-[#dd9f42]" />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{pool.name}</h3>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                            {pool.members.length} member{pool.members.length !== 1 ? "s" : ""}
                          </span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">
                            {pool._count.tasks} active task{pool._count.tasks !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {pool.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{pool.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { closeAddModal(); setAddMemberPool(pool); }}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#02773b] dark:text-emerald-400 border border-[#02773b]/30 hover:bg-[#02773b]/5 transition-colors"
                        >
                          Members
                        </button>
                        <button
                          onClick={() => { setEditPool(pool); setEditName(pool.name); setEditDesc(pool.description ?? ""); }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          title="Edit pool"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeletePool(pool)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          title="Delete pool"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setExpanded(isExpanded ? null : pool.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          <svg className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                        {pool.members.length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No members yet. Click &ldquo;Members&rdquo; to add some.</p>
                        ) : (
                          <div className="space-y-2">
                            {pool.members.map(m => (
                              <div key={m.id} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center text-[11px] font-bold text-[#02773b] dark:text-emerald-400 shrink-0">
                                    {(m.user.displayName ?? m.user.name).charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                                      {m.user.displayName ?? m.user.name}
                                    </p>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                      {m.user.email}{m.user.department ? ` · ${m.user.department}` : ""}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => removeMember(pool.id, m.userId)}
                                  className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:underline shrink-0"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create pool modal */}
      {showCreate && (
        <ModalShell title="New Pool" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Pool Name *</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="e.g. Legal Review Queue"
                className={inputCls}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Description</label>
              <textarea
                rows={2}
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="Optional description..."
                className={`${inputCls} resize-none`}
              />
            </div>
            {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={createPool}
                disabled={creating || !createName.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-60 transition-colors"
              >
                {creating && <IconSpinner />}
                Create Pool
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Edit pool modal */}
      {editPool && (
        <ModalShell title="Edit Pool" onClose={() => setEditPool(null)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Pool Name</label>
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Description</label>
              <textarea rows={2} value={editDesc} onChange={e => setEditDesc(e.target.value)} className={`${inputCls} resize-none`} />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditPool(null)} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving || !editName.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-60 transition-colors"
              >
                {saving && <IconSpinner />}
                Save Changes
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Add member modal */}
      {addMemberPool && (
        <ModalShell title={`Members — ${addMemberPool.name}`} onClose={closeAddModal}>
          <div className="space-y-4">

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
              {([
                ["department", "By Department"],
                ["role", "By Role"],
                ["all", "All Users"],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setAddMemberTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    addMemberTab === tab
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── By Department ── */}
            {addMemberTab === "department" && (
              <div className="space-y-2">
                {!selectedDept ? (
                  <div className="relative" ref={deptDropdownRef}>
                    <div className="relative">
                      <input
                        type="text"
                        value={deptQuery}
                        onChange={e => { setDeptQuery(e.target.value); setDeptDropdownOpen(true); }}
                        onFocus={() => setDeptDropdownOpen(true)}
                        placeholder="Type to filter departments..."
                        className={inputCls}
                        autoFocus
                      />
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                    {deptDropdownOpen && filteredDepts.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                        {filteredDepts.map(d => (
                          <button
                            key={d.name}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setSelectedDept(d.name); setDeptQuery(""); setDeptDropdownOpen(false); }}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                              </svg>
                              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</span>
                            </div>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 ml-2">{d.userCount} staff</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Selected dept badge + change */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#02773b]/5 dark:bg-[#02773b]/10 rounded-xl border border-[#02773b]/20">
                        <svg className="w-3.5 h-3.5 text-[#02773b] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                        </svg>
                        <span className="text-xs font-semibold text-[#02773b] dark:text-emerald-400 truncate">{selectedDept}</span>
                      </div>
                      <button onClick={() => { setSelectedDept(null); setDeptUsers([]); setDeptUserQuery(""); }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Change">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                    {/* Filter + Add All row */}
                    <div className="flex gap-2">
                      <input type="text" value={deptUserQuery} onChange={e => setDeptUserQuery(e.target.value)} placeholder="Filter members..." className={`${inputCls} flex-1`} autoFocus />
                      {(() => {
                        const pending = filteredDeptUsers.filter(u => !addMemberPool.members.some(m => m.userId === u.id));
                        return pending.length > 0 ? (
                          <button onClick={() => addAllMembers(filteredDeptUsers)} disabled={addingAll} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#02773b] text-white hover:bg-[#025f2f] disabled:opacity-60 transition-colors whitespace-nowrap">
                            {addingAll ? <IconSpinner className="w-3 h-3" /> : null}
                            Add all {pending.length}
                          </button>
                        ) : null;
                      })()}
                    </div>
                    {/* User list */}
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden max-h-44 overflow-y-auto">
                      {loadingDeptUsers ? (
                        <div className="flex items-center justify-center py-5"><IconSpinner className="w-4 h-4 text-gray-400" /></div>
                      ) : filteredDeptUsers.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center px-3 py-4">No matching members</p>
                      ) : (
                        filteredDeptUsers.map(u => (
                          <UserRow key={u.id} u={u} alreadyMember={addMemberPool.members.some(m => m.userId === u.id)} addingMember={addingMember} onAdd={addMember} />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── By Role ── */}
            {addMemberTab === "role" && (
              <div className="space-y-2">
                {!selectedRole ? (
                  <div className="relative" ref={roleDropdownRef}>
                    <div className="relative">
                      <input
                        type="text"
                        value={roleQuery}
                        onChange={e => { setRoleQuery(e.target.value); setRoleDropdownOpen(true); }}
                        onFocus={() => setRoleDropdownOpen(true)}
                        placeholder="Type to filter roles..."
                        className={inputCls}
                        autoFocus
                      />
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                    {roleDropdownOpen && filteredRoles.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                        {filteredRoles.map(r => (
                          <button
                            key={r.id}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setSelectedRole(r.name); setRoleQuery(""); setRoleDropdownOpen(false); }}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{fmtRole(r.name)}</p>
                              {r.description && <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{r.description}</p>}
                            </div>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 ml-2">{r.userCount} users</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Selected role badge + change */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-950/20 rounded-xl border border-violet-200 dark:border-violet-800/50">
                        <svg className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                        <span className="text-xs font-semibold text-violet-700 dark:text-violet-400 truncate">{fmtRole(selectedRole)}</span>
                      </div>
                      <button onClick={() => { setSelectedRole(null); setRoleUsers([]); setRoleUserQuery(""); }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Change">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                    {/* Filter + Add All row */}
                    <div className="flex gap-2">
                      <input type="text" value={roleUserQuery} onChange={e => setRoleUserQuery(e.target.value)} placeholder="Filter members..." className={`${inputCls} flex-1`} autoFocus />
                      {(() => {
                        const pending = filteredRoleUsers.filter(u => !addMemberPool.members.some(m => m.userId === u.id));
                        return pending.length > 0 ? (
                          <button onClick={() => addAllMembers(filteredRoleUsers)} disabled={addingAll} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#02773b] text-white hover:bg-[#025f2f] disabled:opacity-60 transition-colors whitespace-nowrap">
                            {addingAll ? <IconSpinner className="w-3 h-3" /> : null}
                            Add all {pending.length}
                          </button>
                        ) : null;
                      })()}
                    </div>
                    {/* User list */}
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden max-h-44 overflow-y-auto">
                      {loadingRoleUsers ? (
                        <div className="flex items-center justify-center py-5"><IconSpinner className="w-4 h-4 text-gray-400" /></div>
                      ) : filteredRoleUsers.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 text-center px-3 py-4">No matching members</p>
                      ) : (
                        filteredRoleUsers.map(u => (
                          <UserRow key={u.id} u={u} alreadyMember={addMemberPool.members.some(m => m.userId === u.id)} addingMember={addingMember} onAdd={addMember} />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── All Users ── */}
            {addMemberTab === "all" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={allUserQuery}
                      onChange={e => setAllUserQuery(e.target.value)}
                      placeholder="Search by name, email or job title..."
                      className={inputCls}
                      autoFocus
                    />
                    {searchingAll && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <IconSpinner className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                    )}
                  </div>
                  {(() => {
                    const pending = allUserResults.filter(u => !addMemberPool.members.some(m => m.userId === u.id));
                    return pending.length > 0 ? (
                      <button onClick={() => addAllMembers(allUserResults)} disabled={addingAll} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#02773b] text-white hover:bg-[#025f2f] disabled:opacity-60 transition-colors whitespace-nowrap">
                        {addingAll ? <IconSpinner className="w-3 h-3" /> : null}
                        Add all {pending.length}
                      </button>
                    ) : null;
                  })()}
                </div>
                {(allUserResults.length > 0 || (allUserQuery.length >= 2 && !searchingAll)) && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden max-h-44 overflow-y-auto">
                    {allUserResults.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center px-3 py-4">No users found</p>
                    ) : (
                      allUserResults.map(u => (
                        <UserRow key={u.id} u={u} alreadyMember={addMemberPool.members.some(m => m.userId === u.id)} addingMember={addingMember} onAdd={addMember} />
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {memberError && <p className="text-xs text-red-600 dark:text-red-400">{memberError}</p>}

            {/* Current members */}
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Current Members ({addMemberPool.members.length})
              </p>
              {addMemberPool.members.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No members yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {addMemberPool.members.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[#02773b]/10 flex items-center justify-center text-[10px] font-bold text-[#02773b] dark:text-emerald-400 shrink-0">
                          {(m.user.displayName ?? m.user.name).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{m.user.displayName ?? m.user.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{m.user.department ? `${m.user.department} · ` : ""}{m.user.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeMember(addMemberPool.id, m.userId)}
                        className="text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 hover:underline shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={closeAddModal}
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Done
            </button>
          </div>
        </ModalShell>
      )}

      {/* Delete confirmation */}
      {deletePool && (
        <ModalShell title="Delete Pool" onClose={() => setDeletePool(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Are you sure you want to delete <strong>&ldquo;{deletePool.name}&rdquo;</strong>? This cannot be undone.
              {deletePool._count.tasks > 0 && (
                <span className="block mt-1 text-red-600 dark:text-red-400 text-xs">
                  This pool has {deletePool._count.tasks} active task(s) and cannot be deleted.
                </span>
              )}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeletePool(null)} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deletePool._count.tasks > 0}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deleting && <IconSpinner />}
                Delete Pool
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
