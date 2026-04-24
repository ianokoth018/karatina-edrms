"use client";

import { useState, useEffect, useCallback } from "react";

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
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

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

  // User search for add-member
  useEffect(() => {
    if (!userSearch.trim() || userSearch.length < 2) { setUserResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users?search=${encodeURIComponent(userSearch)}&limit=10`);
        const data = await res.json();
        setUserResults(data.users ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [userSearch]);

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
      setUserSearch("");
      setUserResults([]);
      await load();
      // Refresh the modal's pool data
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
                          onClick={() => { setAddMemberPool(pool); setUserSearch(""); setUserResults([]); setMemberError(null); }}
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
        <ModalShell title={`Members — ${addMemberPool.name}`} onClose={() => setAddMemberPool(null)}>
          <div className="space-y-4">
            {/* Search */}
            <div>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Add Member</label>
              <div className="relative">
                <input
                  type="text"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className={inputCls}
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <IconSpinner className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                )}
              </div>
              {userResults.length > 0 && (
                <div className="mt-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                  {userResults.map(u => {
                    const alreadyMember = addMemberPool.members.some(m => m.userId === u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => !alreadyMember && addMember(u.id)}
                        disabled={alreadyMember || addingMember === u.id}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${alreadyMember ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{u.displayName ?? u.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{u.email}{u.department ? ` · ${u.department}` : ""}</p>
                        </div>
                        {addingMember === u.id ? (
                          <IconSpinner className="w-3.5 h-3.5 text-[#02773b] shrink-0" />
                        ) : alreadyMember ? (
                          <span className="text-[10px] text-gray-400 shrink-0">Already added</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-[#02773b] dark:text-emerald-400 shrink-0">Add</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {memberError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{memberError}</p>}
            </div>

            {/* Current members */}
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Current Members ({addMemberPool.members.length})
              </p>
              {addMemberPool.members.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">No members yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {addMemberPool.members.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[#02773b]/10 flex items-center justify-center text-[10px] font-bold text-[#02773b] dark:text-emerald-400 shrink-0">
                          {(m.user.displayName ?? m.user.name).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{m.user.displayName ?? m.user.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{m.user.email}</p>
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
              onClick={() => setAddMemberPool(null)}
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
