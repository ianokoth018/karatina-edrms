"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Survey {
  id: string;
  name: string;
  location: string;
  estimatedVolume: number;
  actualVolume: number;
  boxCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  condition: string;
  notes: string | null;
  status: string;
  createdAt: string;
  _count?: { scanBatches: number };
}

interface ScanBatch {
  id: string;
  surveyId: string | null;
  survey: { id: string; name: string; location: string } | null;
  batchNumber: string;
  operator: string;
  scanner: string;
  startedAt: string;
  finishedAt: string | null;
  expectedPages: number;
  actualPages: number;
  legibleCount: number;
  illegibleCount: number;
  skewedCount: number;
  blankCount: number;
  missingCount: number;
  notes: string | null;
  status: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const inputCls =
  "w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green";
const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
const btnPrimary =
  "h-9 px-4 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors";
const btnSecondary =
  "h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PLANNED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    REJECTED: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? map.PLANNED}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function conditionBadge(c: string) {
  const map: Record<string, string> = {
    GOOD: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    FAIR: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
    POOR: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[c] ?? map.FAIR}`}>{c}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DigitisationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<"surveys" | "batches">("surveys");
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [batches, setBatches] = useState<ScanBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Forms
  const [showNewSurvey, setShowNewSurvey] = useState(false);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);

  const [newSurvey, setNewSurvey] = useState({
    name: "",
    location: "",
    estimatedVolume: 0,
    boxCount: 0,
    earliestDate: "",
    latestDate: "",
    condition: "FAIR",
    notes: "",
  });
  const [newBatch, setNewBatch] = useState({
    surveyId: "",
    batchNumber: "",
    operator: "",
    scanner: "",
    expectedPages: 0,
    notes: "",
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) router.replace("/dashboard");
  }, [session, status, router]);

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadSurveys = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter ? `/api/admin/surveys?status=${statusFilter}` : "/api/admin/surveys";
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSurveys(data.surveys ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter ? `/api/admin/scan-batches?status=${statusFilter}` : "/api/admin/scan-batches";
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBatches(data.batches ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Surveys list is also used as a dropdown in the "Start batch" form, so
  // always keep it warm.
  const loadAllSurveysForDropdown = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/surveys");
      if (res.ok) {
        const data = await res.json();
        setSurveys(data.surveys ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setStatusFilter("");
  }, [tab]);

  useEffect(() => {
    if (tab === "surveys") loadSurveys();
    else loadBatches();
  }, [tab, loadSurveys, loadBatches]);

  useEffect(() => {
    // Surveys also needed in the New Batch dropdown when we're on the batches tab
    if (tab === "batches") loadAllSurveysForDropdown();
  }, [tab, loadAllSurveysForDropdown]);

  // ── Create handlers ──────────────────────────────────────────────────────

  async function createSurvey(e: React.FormEvent) {
    e.preventDefault();
    setSavingSurvey(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSurvey),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShowNewSurvey(false);
      setNewSurvey({ name: "", location: "", estimatedVolume: 0, boxCount: 0, earliestDate: "", latestDate: "", condition: "FAIR", notes: "" });
      await loadSurveys();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create survey");
    } finally {
      setSavingSurvey(false);
    }
  }

  async function createBatch(e: React.FormEvent) {
    e.preventDefault();
    setSavingBatch(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/scan-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newBatch, surveyId: newBatch.surveyId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShowNewBatch(false);
      setNewBatch({ surveyId: "", batchNumber: "", operator: "", scanner: "", expectedPages: 0, notes: "" });
      await loadBatches();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setSavingBatch(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Digitisation</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Records surveys and scan-batch QA. Operators record legibility, orientation and completeness
            counts here as physical records are digitised.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setTab("surveys")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "surveys"
              ? "border-karu-green text-karu-green"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          Surveys
        </button>
        <button
          onClick={() => setTab("batches")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "batches"
              ? "border-karu-green text-karu-green"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          Scan batches
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-karu-green"
        >
          <option value="">All statuses</option>
          {tab === "surveys" ? (
            <>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
            </>
          ) : (
            <>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
            </>
          )}
        </select>
        {tab === "surveys" ? (
          <button onClick={() => { setShowNewSurvey(true); setShowNewBatch(false); }} className={btnPrimary}>
            + New survey
          </button>
        ) : (
          <button onClick={() => { setShowNewBatch(true); setShowNewSurvey(false); }} className={btnPrimary}>
            + Start batch
          </button>
        )}
      </div>

      {/* New survey form */}
      {showNewSurvey && tab === "surveys" && (
        <form
          onSubmit={createSurvey}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-karu-green/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New records survey</h2>
            <button type="button" onClick={() => setShowNewSurvey(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Survey name *</label>
              <input required value={newSurvey.name} onChange={(e) => setNewSurvey((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Registry inventory — Block A" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location *</label>
              <input required value={newSurvey.location} onChange={(e) => setNewSurvey((p) => ({ ...p, location: e.target.value }))} placeholder="e.g. HQ Main Registry — Cabinet 4" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Estimated volume (documents)</label>
              <input type="number" min={0} value={newSurvey.estimatedVolume} onChange={(e) => setNewSurvey((p) => ({ ...p, estimatedVolume: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Box count</label>
              <input type="number" min={0} value={newSurvey.boxCount} onChange={(e) => setNewSurvey((p) => ({ ...p, boxCount: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Earliest date (text, e.g. 1972)</label>
              <input value={newSurvey.earliestDate} onChange={(e) => setNewSurvey((p) => ({ ...p, earliestDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Latest date</label>
              <input value={newSurvey.latestDate} onChange={(e) => setNewSurvey((p) => ({ ...p, latestDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Condition</label>
              <select value={newSurvey.condition} onChange={(e) => setNewSurvey((p) => ({ ...p, condition: e.target.value }))} className={inputCls}>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="POOR">Poor</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={newSurvey.notes} onChange={(e) => setNewSurvey((p) => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls + " h-auto py-2"} />
            </div>
          </div>
          <div className="px-5 pb-5 flex gap-3">
            <button type="submit" disabled={savingSurvey} className={btnPrimary}>
              {savingSurvey ? "Saving…" : "Create survey"}
            </button>
            <button type="button" onClick={() => setShowNewSurvey(false)} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* New batch form */}
      {showNewBatch && tab === "batches" && (
        <form
          onSubmit={createBatch}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-karu-green/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Start scan batch</h2>
            <button type="button" onClick={() => setShowNewBatch(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Records survey (optional)</label>
              <select value={newBatch.surveyId} onChange={(e) => setNewBatch((p) => ({ ...p, surveyId: e.target.value }))} className={inputCls}>
                <option value="">— Unassigned —</option>
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.location})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Batch number *</label>
              <input required value={newBatch.batchNumber} onChange={(e) => setNewBatch((p) => ({ ...p, batchNumber: e.target.value }))} placeholder="e.g. BATCH-2026-0001" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Operator *</label>
              <input required value={newBatch.operator} onChange={(e) => setNewBatch((p) => ({ ...p, operator: e.target.value }))} placeholder="Staff name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Scanner make/model *</label>
              <input required value={newBatch.scanner} onChange={(e) => setNewBatch((p) => ({ ...p, scanner: e.target.value }))} placeholder="e.g. Kodak i4250" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expected pages</label>
              <input type="number" min={0} value={newBatch.expectedPages} onChange={(e) => setNewBatch((p) => ({ ...p, expectedPages: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={newBatch.notes} onChange={(e) => setNewBatch((p) => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls + " h-auto py-2"} />
            </div>
          </div>
          <div className="px-5 pb-5 flex gap-3">
            <button type="submit" disabled={savingBatch} className={btnPrimary}>
              {savingBatch ? "Saving…" : "Start batch"}
            </button>
            <button type="button" onClick={() => setShowNewBatch(false)} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Content */}
      {tab === "surveys" ? (
        <SurveysList surveys={surveys} loading={loading} />
      ) : (
        <BatchesList batches={batches} loading={loading} onChange={loadBatches} />
      )}
    </div>
  );
}

// ─── Surveys list ─────────────────────────────────────────────────────────────

function SurveysList({ surveys, loading }: { surveys: Survey[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }
  if (surveys.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        No records surveys yet. Use “New survey” to create the first one.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {surveys.map((s) => (
        <Link
          key={s.id}
          href={`/admin/digitisation/${s.id}`}
          className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:border-karu-green/40 hover:shadow-md transition-all"
        >
          <div className="flex items-start justify-between mb-3 gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-karu-green transition-colors truncate flex-1">
              {s.name}
            </h3>
            {statusBadge(s.status)}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.location}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-gray-400">Est.</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{s.estimatedVolume.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400">Boxes</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{s.boxCount}</div>
            </div>
            <div>
              <div className="text-gray-400">Batches</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{s._count?.scanBatches ?? 0}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            {conditionBadge(s.condition)}
            {s.earliestDate && s.latestDate && <span>{s.earliestDate} – {s.latestDate}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Batches list ─────────────────────────────────────────────────────────────

function BatchesList({ batches, loading, onChange }: { batches: ScanBatch[]; loading: boolean; onChange: () => void }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }
  if (batches.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        No scan batches yet. Use “Start batch” to record a new one.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {batches.map((b) => (
        <BatchCard key={b.id} batch={b} onChange={onChange} />
      ))}
    </div>
  );
}

// ─── Batch card with QA counters ──────────────────────────────────────────────

function BatchCard({ batch, onChange }: { batch: ScanBatch; onChange: () => void }) {
  const [local, setLocal] = useState(batch);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [summary, setSummary] = useState<{ decision: string; reason: string; passRate: number } | null>(null);

  useEffect(() => {
    setLocal(batch);
  }, [batch]);

  const editable = local.status === "IN_PROGRESS";

  async function persistField(field: keyof ScanBatch, value: number) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/scan-batches/${batch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setLocal(data.batch);
      }
    } finally {
      setSaving(false);
    }
  }

  function bump(field: "actualPages" | "legibleCount" | "illegibleCount" | "skewedCount" | "blankCount" | "missingCount", delta: number) {
    if (!editable) return;
    const next = Math.max(0, (local[field] as number) + delta);
    setLocal((p) => ({ ...p, [field]: next }));
    persistField(field, next);
  }

  async function finalize() {
    if (!confirm(`Finalize batch ${local.batchNumber}? This will lock the QA counts and apply the 5% illegibility / 0-missing decision rule.`)) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/admin/scan-batches/${batch.id}/finalize`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLocal(data.batch);
        setSummary(data.summary);
        onChange();
      } else {
        alert(data.error ?? "Failed to finalize");
      }
    } finally {
      setFinalizing(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete batch ${local.batchNumber}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/scan-batches/${batch.id}`, { method: "DELETE" });
    if (res.ok) onChange();
  }

  const passRate = local.actualPages > 0 ? (local.legibleCount / local.actualPages) * 100 : 0;
  const illegibilityRate = local.actualPages > 0 ? (local.illegibleCount / local.actualPages) * 100 : 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-3 justify-between bg-gradient-to-r from-karu-green/5 to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{local.batchNumber}</h3>
          {statusBadge(local.status)}
          {saving && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <button onClick={finalize} disabled={finalizing} className="h-8 px-3 rounded-lg bg-karu-green text-white text-xs font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors">
              {finalizing ? "Finalizing…" : "Finalize"}
            </button>
          )}
          <button onClick={remove} className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
            Delete
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-gray-400">Operator</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{local.operator}</div>
          </div>
          <div>
            <div className="text-gray-400">Scanner</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{local.scanner}</div>
          </div>
          <div>
            <div className="text-gray-400">Survey</div>
            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{local.survey?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-gray-400">Expected</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{local.expectedPages.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Counter label="Pages scanned"  value={local.actualPages}    onPlus={() => bump("actualPages", 1)}    onMinus={() => bump("actualPages", -1)}    onSet={(v) => persistField("actualPages", v)}    editable={editable} accent="default" />
          <Counter label="Legible"        value={local.legibleCount}   onPlus={() => bump("legibleCount", 1)}   onMinus={() => bump("legibleCount", -1)}   onSet={(v) => persistField("legibleCount", v)}   editable={editable} accent="green" />
          <Counter label="Illegible"      value={local.illegibleCount} onPlus={() => bump("illegibleCount", 1)} onMinus={() => bump("illegibleCount", -1)} onSet={(v) => persistField("illegibleCount", v)} editable={editable} accent="red" />
          <Counter label="Skewed"         value={local.skewedCount}    onPlus={() => bump("skewedCount", 1)}    onMinus={() => bump("skewedCount", -1)}    onSet={(v) => persistField("skewedCount", v)}    editable={editable} accent="amber" />
          <Counter label="Blank"          value={local.blankCount}     onPlus={() => bump("blankCount", 1)}     onMinus={() => bump("blankCount", -1)}     onSet={(v) => persistField("blankCount", v)}     editable={editable} accent="default" />
          <Counter label="Missing"        value={local.missingCount}   onPlus={() => bump("missingCount", 1)}   onMinus={() => bump("missingCount", -1)}   onSet={(v) => persistField("missingCount", v)}   editable={editable} accent="red" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
            <div className="text-gray-400">Pass rate</div>
            <div className="font-semibold text-emerald-700 dark:text-emerald-400">{passRate.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
            <div className="text-gray-400">Illegibility rate</div>
            <div className={`font-semibold ${illegibilityRate > 5 ? "text-red-700 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}>
              {illegibilityRate.toFixed(1)}% <span className="text-gray-400 font-normal">/ 5% threshold</span>
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
            <div className="text-gray-400">Started</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{new Date(local.startedAt).toLocaleString()}</div>
          </div>
        </div>

        {summary && (
          <div className={`rounded-lg px-3 py-2 text-xs ${summary.decision === "COMPLETED" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"}`}>
            <strong>{summary.decision}:</strong> {summary.reason}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Counter ──────────────────────────────────────────────────────────────────

function Counter({
  label,
  value,
  onPlus,
  onMinus,
  onSet,
  editable,
  accent,
}: {
  label: string;
  value: number;
  onPlus: () => void;
  onMinus: () => void;
  onSet: (v: number) => void;
  editable: boolean;
  accent: "default" | "green" | "red" | "amber";
}) {
  const ring = useMemo(() => {
    switch (accent) {
      case "green": return "ring-emerald-200 dark:ring-emerald-900/40";
      case "red":   return "ring-red-200 dark:ring-red-900/40";
      case "amber": return "ring-amber-200 dark:ring-amber-900/40";
      default:      return "ring-gray-200 dark:ring-gray-700";
    }
  }, [accent]);

  return (
    <div className={`rounded-lg ring-1 ${ring} bg-white dark:bg-gray-800/50 p-2`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          disabled={!editable}
          onClick={onMinus}
          className="w-6 h-6 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm leading-none disabled:opacity-40 disabled:cursor-not-allowed"
        >
          −
        </button>
        <input
          type="number"
          min={0}
          disabled={!editable}
          value={value}
          onChange={(e) => onSet(Math.max(0, Number(e.target.value) | 0))}
          className="flex-1 min-w-0 h-7 text-center text-sm font-semibold text-gray-900 dark:text-gray-100 bg-transparent outline-none disabled:opacity-80"
        />
        <button
          type="button"
          disabled={!editable}
          onClick={onPlus}
          className="w-6 h-6 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm leading-none disabled:opacity-40 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </div>
  );
}
