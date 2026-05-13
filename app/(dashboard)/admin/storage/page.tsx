"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface PolicyState {
  id: string | null;
  name: string;
  isActive: boolean;
  demoteToWarmDays: number;
  demoteToArchiveDays: number;
  restoreStrategy: "auto" | "manual";
}

interface TierStat {
  count: number;
  totalBytes: number;
}

interface ArchivedFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  tierMovedAt: string | null;
  lastAccessedAt: string | null;
  document: { id: string; title: string; referenceNumber: string } | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export default function AdminStoragePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [stats, setStats] = useState<Record<string, TierStat>>({
    hot: { count: 0, totalBytes: 0 },
    warm: { count: 0, totalBytes: 0 },
    archive: { count: 0, totalBytes: 0 },
  });
  const [archivedFiles, setArchivedFiles] = useState<ArchivedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [restoring, setRestoring] = useState<Record<string, boolean>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [policyRes, statsRes] = await Promise.all([
        fetch("/api/admin/storage/policy"),
        fetch("/api/admin/storage"),
      ]);
      if (policyRes.ok) {
        const j = await policyRes.json();
        setPolicy({
          id: j.policy.id ?? null,
          name: j.policy.name,
          isActive: j.policy.isActive ?? true,
          demoteToWarmDays: j.policy.demoteToWarmDays,
          demoteToArchiveDays: j.policy.demoteToArchiveDays,
          restoreStrategy: j.policy.restoreStrategy,
        });
      }
      if (statsRes.ok) {
        const j = await statsRes.json();
        setStats(j.stats);
        setArchivedFiles(j.archivedFiles ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchAll();
  }, [status, fetchAll]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!policy) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/storage/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoteToWarmDays: policy.demoteToWarmDays,
          demoteToArchiveDays: policy.demoteToArchiveDays,
          restoreStrategy: policy.restoreStrategy,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: j.error ?? "Save failed" });
      } else {
        setMessage({ kind: "ok", text: "Policy saved." });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (!confirm("Run a tiering pass now? This may move files between tiers.")) return;
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/storage/run", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: j.error ?? "Run failed" });
      } else {
        setMessage({
          kind: "ok",
          text: `Tiering complete — demoted ${j.demotedToWarm} to warm, ${j.demotedToArchive} to archive.`,
        });
        fetchAll();
      }
    } finally {
      setRunning(false);
    }
  }

  async function handleRestore(fileId: string) {
    setRestoring((p) => ({ ...p, [fileId]: true }));
    try {
      const res = await fetch("/api/admin/storage/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: j.error ?? "Restore failed" });
      } else {
        setMessage({ kind: "ok", text: "File restored to hot tier." });
        fetchAll();
      }
    } finally {
      setRestoring((p) => ({ ...p, [fileId]: false }));
    }
  }

  if (status === "loading") return null;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Storage Tiering</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Move bytes from hot disk to warm/archive directories based on age + access patterns.
            Files demote automatically per policy; archived files restore on read when policy is &quot;auto&quot;.
          </p>
        </div>
        <button
          onClick={handleRunNow}
          disabled={running}
          className="h-10 px-4 rounded-xl bg-[color:var(--brand-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Running…" : "Run tiering now"}
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm border ${
            message.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-900 dark:text-emerald-300"
              : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-900 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Per-tier stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(["hot", "warm", "archive"] as const).map((tier) => {
          const s = stats[tier] ?? { count: 0, totalBytes: 0 };
          const tone =
            tier === "hot"
              ? "from-red-50 to-orange-50 border-red-200 dark:from-red-900/20 dark:to-orange-900/20 dark:border-red-900"
              : tier === "warm"
              ? "from-amber-50 to-yellow-50 border-amber-200 dark:from-amber-900/20 dark:to-yellow-900/20 dark:border-amber-900"
              : "from-sky-50 to-indigo-50 border-sky-200 dark:from-sky-900/20 dark:to-indigo-900/20 dark:border-sky-900";
          return (
            <div
              key={tier}
              className={`rounded-2xl border bg-gradient-to-br ${tone} p-5`}
            >
              <div className="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
                {tier}
              </div>
              <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
                {s.count.toLocaleString()}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                files · {formatBytes(s.totalBytes)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Policy form */}
      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-5 space-y-4"
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Active policy
        </h2>
        {!policy ? (
          <div className="text-sm text-gray-500">{loading ? "Loading…" : "No policy"}</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Demote to warm after (days)">
                <input
                  type="number"
                  min={1}
                  value={policy.demoteToWarmDays}
                  onChange={(e) =>
                    setPolicy({ ...policy, demoteToWarmDays: Number(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Demote to archive after (days)">
                <input
                  type="number"
                  min={1}
                  value={policy.demoteToArchiveDays}
                  onChange={(e) =>
                    setPolicy({ ...policy, demoteToArchiveDays: Number(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Restore strategy">
                <select
                  value={policy.restoreStrategy}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      restoreStrategy: e.target.value as "auto" | "manual",
                    })
                  }
                  className={inputCls}
                >
                  <option value="auto">auto — restore on read</option>
                  <option value="manual">manual — 409 until admin restores</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-4 rounded-xl bg-[color:var(--brand-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save policy"}
              </button>
            </div>
          </>
        )}
      </form>

      {/* Archived files list */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Archived files
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Files currently in the archive tier. Restore brings them back to hot disk.
          </p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : archivedFiles.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No archived files.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Moved to archive</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {archivedFiles.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800 dark:text-gray-200">
                    {f.fileName}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                    {f.document ? (
                      <>
                        <div className="font-medium">{f.document.title}</div>
                        <div className="text-gray-500">{f.document.referenceNumber}</div>
                      </>
                    ) : (
                      <span className="italic text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {f.tierMovedAt ? new Date(f.tierMovedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRestore(f.id)}
                      disabled={restoring[f.id]}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      {restoring[f.id] ? "Restoring…" : "Restore to hot"}
                    </button>
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

const inputCls =
  "w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
