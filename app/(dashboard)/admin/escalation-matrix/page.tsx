"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EscalationLevel {
  level: number;
  afterHours: number;
  action: "notify" | "reassign" | "both";
  escalateTo: string;
  notifyOriginal: boolean;
  message: string;
}

interface Matrix {
  id: string;
  name: string;
  description: string | null;
  userId: string | null;
  roleId: string | null;
  department: string | null;
  poolId: string | null;
  levels: EscalationLevel[];
  isActive: boolean;
  _user?: { name: string; displayName: string } | null;
  _role?: { name: string } | null;
  _pool?: { name: string } | null;
}

interface User { id: string; name: string; displayName: string; email: string; }
interface Role { id: string; name: string; }
interface Pool { id: string; name: string; }

function uid() { return `l${Math.random().toString(36).slice(2, 8)}`; }

const ACTION_LABELS = { notify: "Notify only", reassign: "Reassign task", both: "Notify + Reassign" };

const ESCALATE_TO_PRESETS = [
  { value: "supervisor", label: "Supervisor / HOD" },
  { value: "user:", label: "Specific User…" },
  { value: "role:", label: "Specific Role…" },
  { value: "pool:", label: "Specific Pool…" },
  { value: "department:", label: "Specific Department…" },
];

// ─── Level editor row ─────────────────────────────────────────────────────────

function LevelRow({ lvl, idx, users, roles, pools, onChange, onRemove }: {
  lvl: EscalationLevel;
  idx: number;
  users: User[];
  roles: Role[];
  pools: Pool[];
  onChange: (patch: Partial<EscalationLevel>) => void;
  onRemove: () => void;
}) {
  const [esType, setEsType] = useState<string>(() => {
    if (lvl.escalateTo === "supervisor") return "supervisor";
    if (lvl.escalateTo.startsWith("user:")) return "user:";
    if (lvl.escalateTo.startsWith("role:")) return "role:";
    if (lvl.escalateTo.startsWith("pool:")) return "pool:";
    if (lvl.escalateTo.startsWith("department:")) return "department:";
    return "supervisor";
  });

  const input = "h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]";
  const sel = `${input} cursor-pointer`;

  return (
    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3 relative">
      {/* Level badge + remove */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-[#02773b]/10 text-[#02773b] text-xs font-bold">
          Level {lvl.level}
        </span>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Trigger */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Trigger after</label>
          <div className="flex items-center gap-1">
            <input type="number" min={1} value={lvl.afterHours} onChange={(e) => onChange({ afterHours: Number(e.target.value) || 1 })} className={`${input} w-16 text-center`} />
            <span className="text-xs text-gray-500">hours</span>
          </div>
        </div>

        {/* Action */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Action</label>
          <select value={lvl.action} onChange={(e) => onChange({ action: e.target.value as EscalationLevel["action"] })} className={`${sel} w-full`}>
            {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Escalate to */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Escalate to</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={esType}
            onChange={(e) => {
              setEsType(e.target.value);
              if (e.target.value === "supervisor") onChange({ escalateTo: "supervisor" });
              else onChange({ escalateTo: e.target.value });
            }}
            className={`${sel} flex-1`}
          >
            {ESCALATE_TO_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>

          {esType === "user:" && (
            <select
              value={lvl.escalateTo.replace("user:", "")}
              onChange={(e) => onChange({ escalateTo: `user:${e.target.value}` })}
              className={`${sel} flex-1`}
            >
              <option value="">— select user —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.name}</option>)}
            </select>
          )}
          {esType === "role:" && (
            <select
              value={lvl.escalateTo.replace("role:", "")}
              onChange={(e) => onChange({ escalateTo: `role:${e.target.value}` })}
              className={`${sel} flex-1`}
            >
              <option value="">— select role —</option>
              {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          )}
          {esType === "pool:" && (
            <select
              value={lvl.escalateTo.replace("pool:", "")}
              onChange={(e) => onChange({ escalateTo: `pool:${e.target.value}` })}
              className={`${sel} flex-1`}
            >
              <option value="">— select pool —</option>
              {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {esType === "department:" && (
            <input
              value={lvl.escalateTo.replace("department:", "")}
              onChange={(e) => onChange({ escalateTo: `department:${e.target.value}` })}
              placeholder="Department name"
              className={`${input} flex-1`}
            />
          )}
        </div>
      </div>

      {/* Options */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={lvl.notifyOriginal} onChange={(e) => onChange({ notifyOriginal: e.target.checked })} className="h-3.5 w-3.5 rounded accent-[#02773b]" />
          Remind original assignee
        </label>
      </div>

      {/* Custom message */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Custom message <span className="text-gray-400">(optional)</span></label>
        <input
          value={lvl.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="e.g. Task requires urgent attention — SLA exceeded"
          className={`${input} w-full`}
        />
      </div>
    </div>
  );
}

// ─── Matrix editor modal / panel ──────────────────────────────────────────────

function MatrixEditor({ matrix, users, roles, pools, onSave, onClose }: {
  matrix: Partial<Matrix> | null;
  users: User[];
  roles: Role[];
  pools: Pool[];
  onSave: (data: Partial<Matrix>) => void;
  onClose: () => void;
}) {
  const isNew = !matrix?.id;
  const [form, setForm] = useState<Partial<Matrix>>({
    name: "", description: "", userId: null, roleId: null, department: null, poolId: null,
    levels: [], isActive: true, ...matrix,
  });

  function addLevel() {
    const nextLevel = (form.levels?.length ?? 0) + 1;
    const prevHours = form.levels?.slice(-1)[0]?.afterHours ?? 0;
    setForm((p) => ({
      ...p,
      levels: [...(p.levels ?? []), {
        level: nextLevel,
        afterHours: prevHours + 24,
        action: "notify",
        escalateTo: "supervisor",
        notifyOriginal: true,
        message: "",
      }],
    }));
  }

  function updateLevel(idx: number, patch: Partial<EscalationLevel>) {
    setForm((p) => ({
      ...p,
      levels: (p.levels ?? []).map((l, i) => i === idx ? { ...l, ...patch } : l),
    }));
  }

  function removeLevel(idx: number) {
    setForm((p) => ({
      ...p,
      levels: (p.levels ?? [])
        .filter((_, i) => i !== idx)
        .map((l, i) => ({ ...l, level: i + 1 })),
    }));
  }

  const sel = "w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]";
  const inp = "w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isNew ? "New Escalation Matrix" : `Edit: ${form.name}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Matrix Name *</label>
              <input value={form.name ?? ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. HOD Escalation Chain" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
              <input value={form.description ?? ""} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="When to use this matrix" className={inp} />
            </div>
          </div>

          {/* Applies to */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Applies To <span className="font-normal text-gray-500">(pick one — leave all blank for a global fallback)</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Specific User</label>
                <select value={form.userId ?? ""} onChange={(e) => setForm((p) => ({ ...p, userId: e.target.value || null, roleId: null, department: null, poolId: null }))} className={sel}>
                  <option value="">— any —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <select value={form.roleId ?? ""} onChange={(e) => setForm((p) => ({ ...p, roleId: e.target.value || null, userId: null, department: null, poolId: null }))} className={sel}>
                  <option value="">— any —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Pool</label>
                <select value={form.poolId ?? ""} onChange={(e) => setForm((p) => ({ ...p, poolId: e.target.value || null, userId: null, roleId: null, department: null }))} className={sel}>
                  <option value="">— any —</option>
                  {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Department</label>
                <input value={form.department ?? ""} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value || null, userId: null, roleId: null, poolId: null }))} placeholder="e.g. Finance" className={inp} />
              </div>
            </div>
          </div>

          {/* Escalation levels */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Escalation Levels</p>
              <button onClick={addLevel} className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Add Level
              </button>
            </div>

            {(form.levels ?? []).length === 0 ? (
              <div className="py-8 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-400">
                No escalation levels yet. Add at least one level to make this matrix effective.
              </div>
            ) : (
              <div className="space-y-3">
                {(form.levels ?? []).map((lvl, i) => (
                  <LevelRow key={`${lvl.level}-${i}`} lvl={lvl} idx={i} users={users} roles={roles} pools={pools}
                    onChange={(patch) => updateLevel(i, patch)}
                    onRemove={() => removeLevel(i)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Visual timeline */}
          {(form.levels ?? []).length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Escalation Timeline</p>
              <div className="flex items-start gap-0">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-[#02773b]" />
                  <div className="w-0.5 h-4 bg-gray-300 dark:bg-gray-600" />
                </div>
                <div className="ml-3 pb-2 text-xs text-gray-600 dark:text-gray-400">Task assigned</div>
              </div>
              {(form.levels ?? []).map((lvl, i) => (
                <div key={i} className="flex items-start gap-0">
                  <div className="flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full bg-amber-400" />
                    {i < (form.levels ?? []).length - 1 && <div className="w-0.5 h-4 bg-gray-300 dark:bg-gray-600" />}
                  </div>
                  <div className="ml-3 pb-2 text-xs text-gray-600 dark:text-gray-400">
                    <strong>+{lvl.afterHours}h</strong> — Level {lvl.level}: {ACTION_LABELS[lvl.action]}
                    {lvl.escalateTo === "supervisor" ? " → Supervisor" : ` → ${lvl.escalateTo}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          <button
            onClick={() => onSave(form)}
            disabled={!form.name?.trim()}
            className="h-9 px-5 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50 transition-colors"
          >
            {isNew ? "Create Matrix" : "Save Changes"}
          </button>
          <button onClick={onClose} className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EscalationMatrixPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [matrices, setMatrices] = useState<Matrix[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Matrix> | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [runningCheck, setRunningCheck] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) router.replace("/dashboard");
  }, [session, status, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, uRes, rRes, pRes] = await Promise.all([
        fetch("/api/admin/escalation-matrix"),
        fetch("/api/admin/users?limit=500"),
        fetch("/api/admin/roles"),
        fetch("/api/workflows/pools"),
      ]);
      if (mRes.ok) setMatrices((await mRes.json()).matrices ?? []);
      if (uRes.ok) setUsers((await uRes.json()).users ?? []);
      if (rRes.ok) setRoles((await rRes.json()).roles ?? []);
      if (pRes.ok) setPools((await pRes.json()).pools ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: Partial<Matrix>) {
    setError(null);
    try {
      const isNew = !data.id;
      const url = isNew ? "/api/admin/escalation-matrix" : `/api/admin/escalation-matrix/${data.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setEditing(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete escalation matrix "${name}"?`)) return;
    await fetch(`/api/admin/escalation-matrix/${id}`, { method: "DELETE" });
    await load();
  }

  async function runCheck() {
    setRunningCheck(true); setCheckResult(null);
    try {
      const res = await fetch("/api/workflows/escalation", { method: "POST" });
      const data = await res.json();
      setCheckResult(`Checked ${data.checked} tasks — ${data.escalated} escalated, ${data.errors} errors.`);
    } catch { setCheckResult("Failed to run check."); }
    finally { setRunningCheck(false); }
  }

  function appliesTo(m: Matrix): string {
    if (m._user) return `User: ${m._user.displayName || m._user.name}`;
    if (m._role) return `Role: ${m._role.name}`;
    if (m._pool) return `Pool: ${m._pool.name}`;
    if (m.department) return `Dept: ${m.department}`;
    return "Global fallback";
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Escalation Matrix</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure automatic escalation chains — who gets notified or takes over when tasks exceed SLA deadlines.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={runCheck}
            disabled={runningCheck}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
          >
            {runningCheck ? <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-[#02773b] rounded-full animate-spin" /> : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
            )}
            Run Check Now
          </button>
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Matrix
          </button>
        </div>
      </div>

      {/* Banners */}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
      {checkResult && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          {checkResult}
        </div>
      )}

      {/* How it works */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">How the escalation matrix works</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-amber-700 dark:text-amber-400">
          {[
            { icon: "⏱", title: "SLA Breach", desc: "The engine checks pending tasks hourly. When a task exceeds its configured threshold, the matching matrix fires." },
            { icon: "🔔", title: "Notify / Reassign", desc: "Each level can notify the supervisor, reassign the task, or both. The original assignee can also be reminded." },
            { icon: "🔗", title: "Matrix Matching", desc: "Match by specific user → their role → their department → global fallback. The most specific match wins." },
          ].map((item) => (
            <div key={item.title} className="flex gap-2">
              <span className="text-base">{item.icon}</span>
              <div><p className="font-semibold">{item.title}</p><p className="mt-0.5">{item.desc}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-delegation info */}
      <div className="bg-[#02773b]/5 dark:bg-[#02773b]/10 border border-[#02773b]/20 rounded-2xl p-4">
        <p className="text-xs font-semibold text-[#02773b] mb-2">Auto-delegation on leave (workflow integration)</p>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
          When a leave request is approved, add a <strong>System Action</strong> node with type <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">create_delegation</code> to automatically delegate the absent staff's tasks to their acting officer for the leave period.
        </p>
        <pre className="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-gray-700 dark:text-gray-300 overflow-x-auto">{`Action type: create_delegation
Delegate field:  acting_officer_id   ← from leave form
Start date field: leave_start_date
End date field:   leave_end_date
Reason: On approved leave {{leave_start_date}} – {{leave_end_date}}`}</pre>
      </div>

      {/* Matrix list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2].map((i) => <div key={i} className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
        </div>
      ) : matrices.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No escalation matrices configured</p>
          <p className="text-xs text-gray-500 mt-1">Create matrices to automate task re-routing when SLAs are missed.</p>
          <button onClick={() => setEditing("new")} className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors">
            Create First Matrix
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {matrices.map((m) => (
            <div key={m.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{m.name}</h3>
                    {!m.isActive && <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">Inactive</span>}
                    <span className="text-xs bg-[#02773b]/10 text-[#02773b] px-2 py-0.5 rounded-full">{appliesTo(m)}</span>
                    <span className="text-xs text-gray-400">{m.levels.length} level{m.levels.length !== 1 ? "s" : ""}</span>
                  </div>
                  {m.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{m.description}</p>}

                  {/* Level summary */}
                  {m.levels.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.levels.map((lvl) => (
                        <span key={lvl.level} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-lg">
                          <span className="font-semibold text-[#02773b]">L{lvl.level}</span>
                          +{lvl.afterHours}h → {ACTION_LABELS[lvl.action]} → {lvl.escalateTo === "supervisor" ? "Supervisor" : lvl.escalateTo}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => setEditing(m)}
                    className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(m.id, m.name)}
                    className="h-8 px-3 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing !== null && (
        <MatrixEditor
          matrix={editing === "new" ? null : editing}
          users={users}
          roles={roles}
          pools={pools}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
