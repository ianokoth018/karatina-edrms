"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

interface MatterRow {
  id: string;
  name: string;
  matterNumber: string;
  description: string | null;
  status: "OPEN" | "CLOSED" | string;
  openedAt: string;
  closedAt: string | null;
  _count: { custodians: number; documents: number; notices: number };
}

export default function LegalMattersPage() {
  const { can, ready } = usePermissions();
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "OPEN" | "CLOSED">("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMatterNumber, setNewMatterNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/matters?${params}`);
      if (!res.ok) throw new Error("Failed to load matters");
      const data = await res.json();
      setMatters(data.matters ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load matters");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    if (ready && can("admin:manage")) load();
  }, [ready, can, load]);

  async function createMatter() {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          matterNumber: newMatterNumber.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to create matter");
      }
      setCreating(false);
      setNewName("");
      setNewDescription("");
      setNewMatterNumber("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create matter");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage")) return <div className="p-6 text-red-600">Forbidden</div>;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Legal Holds</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage matters, custodians, hold notices, and acknowledgements. Documents attached to an open matter are automatically preserved.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="h-10 px-4 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] transition-colors shadow-md shadow-[#02773b]/20"
        >
          New matter
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {creating && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New legal matter</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Matter name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. v. Vendor X — breach of contract"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Matter number <span className="text-gray-400">(auto if blank)</span>
              </label>
              <input
                value={newMatterNumber}
                onChange={(e) => setNewMatterNumber(e.target.value)}
                placeholder="M-2026-001"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              placeholder="Scope of the matter, jurisdictions, and any external references."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm outline-none focus:border-[#02773b]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewDescription("");
                setNewMatterNumber("");
              }}
              className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={createMatter}
              disabled={submitting || !newName.trim()}
              className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Open matter"}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or matter number…"
          className="h-10 flex-1 min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | "OPEN" | "CLOSED")}
          className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading matters…</div>
        ) : matters.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No matters yet. Open one to start a legal hold.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Matter</th>
                <th className="px-4 py-3 text-left">Number</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Custodians</th>
                <th className="px-4 py-3 text-right">Documents</th>
                <th className="px-4 py-3 text-right">Notices</th>
                <th className="px-4 py-3 text-left">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {matters.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/matters/${m.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-[#02773b]"
                    >
                      {m.name}
                    </Link>
                    {m.description && (
                      <div className="text-xs text-gray-500 truncate max-w-md">{m.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{m.matterNumber}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                        m.status === "OPEN"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{m._count.custodians}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{m._count.documents}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{m._count.notices}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(m.openedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
