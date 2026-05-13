"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

interface ScanBatch {
  id: string;
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
  status: string;
}

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
  scanBatches: ScanBatch[];
}

const inputCls =
  "w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green";
const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

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

export default function SurveyDetailPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const params = useParams<{ surveyId: string }>();
  const surveyId = params?.surveyId;

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Survey> | null>(null);

  // Add-batch form
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  const [newBatch, setNewBatch] = useState({
    batchNumber: "",
    operator: "",
    scanner: "",
    expectedPages: 0,
    notes: "",
  });

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) router.replace("/dashboard");
  }, [session, sessionStatus, router]);

  const load = useCallback(async () => {
    if (!surveyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSurvey(data.survey);
      setDraft(data.survey);
    } catch {
      setError("Failed to load survey");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!surveyId || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          location: draft.location,
          estimatedVolume: draft.estimatedVolume,
          actualVolume: draft.actualVolume,
          boxCount: draft.boxCount,
          earliestDate: draft.earliestDate,
          latestDate: draft.latestDate,
          condition: draft.condition,
          notes: draft.notes,
          status: draft.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setEditing(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!surveyId) return;
    setSavingBatch(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/scan-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newBatch, surveyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShowNewBatch(false);
      setNewBatch({ batchNumber: "", operator: "", scanner: "", expectedPages: 0, notes: "" });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start batch");
    } finally {
      setSavingBatch(false);
    }
  }

  if (loading || !survey || !draft) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-40 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  // Aggregate metrics across batches
  const totals = survey.scanBatches.reduce(
    (acc, b) => ({
      actualPages: acc.actualPages + b.actualPages,
      legibleCount: acc.legibleCount + b.legibleCount,
      illegibleCount: acc.illegibleCount + b.illegibleCount,
      expectedPages: acc.expectedPages + b.expectedPages,
      missingCount: acc.missingCount + b.missingCount,
      completed: acc.completed + (b.status === "COMPLETED" ? 1 : 0),
      rejected: acc.rejected + (b.status === "REJECTED" ? 1 : 0),
      active: acc.active + (b.status === "IN_PROGRESS" ? 1 : 0),
    }),
    { actualPages: 0, legibleCount: 0, illegibleCount: 0, expectedPages: 0, missingCount: 0, completed: 0, rejected: 0, active: 0 }
  );

  const aggPassRate = totals.actualPages > 0 ? (totals.legibleCount / totals.actualPages) * 100 : 0;
  const aggIllegibilityRate = totals.actualPages > 0 ? (totals.illegibleCount / totals.actualPages) * 100 : 0;
  const completionPct = survey.estimatedVolume > 0 ? Math.min(100, (totals.actualPages / survey.estimatedVolume) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link href="/admin/digitisation" className="hover:text-karu-green">Digitisation</Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium truncate">{survey.name}</span>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Header card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{survey.name}</h1>
              {statusBadge(survey.status)}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{survey.location}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Edit
              </button>
            ) : (
              <>
                <button onClick={save} disabled={saving} className="h-9 px-4 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setEditing(false); setDraft(survey); }} className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {editing ? (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Name</label>
              <input value={draft.name ?? ""} onChange={(e) => setDraft((p) => ({ ...p!, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input value={draft.location ?? ""} onChange={(e) => setDraft((p) => ({ ...p!, location: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Estimated volume</label>
              <input type="number" min={0} value={draft.estimatedVolume ?? 0} onChange={(e) => setDraft((p) => ({ ...p!, estimatedVolume: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Actual volume (counted)</label>
              <input type="number" min={0} value={draft.actualVolume ?? 0} onChange={(e) => setDraft((p) => ({ ...p!, actualVolume: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Box count</label>
              <input type="number" min={0} value={draft.boxCount ?? 0} onChange={(e) => setDraft((p) => ({ ...p!, boxCount: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Condition</label>
              <select value={draft.condition ?? "FAIR"} onChange={(e) => setDraft((p) => ({ ...p!, condition: e.target.value }))} className={inputCls}>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="POOR">Poor</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Earliest date</label>
              <input value={draft.earliestDate ?? ""} onChange={(e) => setDraft((p) => ({ ...p!, earliestDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Latest date</label>
              <input value={draft.latestDate ?? ""} onChange={(e) => setDraft((p) => ({ ...p!, latestDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={draft.status ?? "PLANNED"} onChange={(e) => setDraft((p) => ({ ...p!, status: e.target.value }))} className={inputCls}>
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={draft.notes ?? ""} onChange={(e) => setDraft((p) => ({ ...p!, notes: e.target.value }))} rows={2} className={inputCls + " h-auto py-2"} />
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Estimated" value={survey.estimatedVolume.toLocaleString()} />
            <Stat label="Actual" value={survey.actualVolume.toLocaleString()} />
            <Stat label="Boxes" value={survey.boxCount.toLocaleString()} />
            <Stat label="Condition" value={survey.condition} />
            <Stat label="Earliest date" value={survey.earliestDate ?? "—"} />
            <Stat label="Latest date" value={survey.latestDate ?? "—"} />
            <Stat label="Created" value={new Date(survey.createdAt).toLocaleDateString()} />
            <Stat label="Batches" value={String(survey.scanBatches.length)} />
            {survey.notes && (
              <div className="sm:col-span-4">
                <div className="text-xs text-gray-400">Notes</div>
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{survey.notes}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Digitisation progress</h2>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{totals.actualPages.toLocaleString()} of ~{survey.estimatedVolume.toLocaleString()} pages scanned</span>
              <span>{completionPct.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full bg-karu-green transition-all" style={{ width: `${completionPct}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <Stat label="Pass rate" value={`${aggPassRate.toFixed(1)}%`} accent="green" />
            <Stat label="Illegibility" value={`${aggIllegibilityRate.toFixed(1)}%`} accent={aggIllegibilityRate > 5 ? "red" : "default"} />
            <Stat label="Active batches" value={String(totals.active)} />
            <Stat label="Completed" value={String(totals.completed)} accent="green" />
            <Stat label="Rejected" value={String(totals.rejected)} accent={totals.rejected > 0 ? "red" : "default"} />
          </div>
        </div>
      </div>

      {/* Batches */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Scan batches</h2>
          <button onClick={() => setShowNewBatch((v) => !v)} className="h-8 px-3 rounded-lg bg-karu-green text-white text-xs font-medium hover:bg-karu-green-dark transition-colors">
            + Add batch
          </button>
        </div>

        {showNewBatch && (
          <form onSubmit={addBatch} className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-karu-green/5 to-transparent grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Batch number *</label>
              <input required value={newBatch.batchNumber} onChange={(e) => setNewBatch((p) => ({ ...p, batchNumber: e.target.value }))} placeholder="e.g. BATCH-2026-0001" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Operator *</label>
              <input required value={newBatch.operator} onChange={(e) => setNewBatch((p) => ({ ...p, operator: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Scanner *</label>
              <input required value={newBatch.scanner} onChange={(e) => setNewBatch((p) => ({ ...p, scanner: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expected pages</label>
              <input type="number" min={0} value={newBatch.expectedPages} onChange={(e) => setNewBatch((p) => ({ ...p, expectedPages: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={savingBatch} className="h-9 px-4 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors">
                {savingBatch ? "Saving…" : "Start batch"}
              </button>
              <button type="button" onClick={() => setShowNewBatch(false)} className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}

        {survey.scanBatches.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            No scan batches recorded for this survey yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {survey.scanBatches.map((b) => {
              const passRate = b.actualPages > 0 ? (b.legibleCount / b.actualPages) * 100 : 0;
              const illegibility = b.actualPages > 0 ? (b.illegibleCount / b.actualPages) * 100 : 0;
              return (
                <div key={b.id} className="px-5 py-4 grid grid-cols-1 sm:grid-cols-6 gap-3 items-center">
                  <div className="sm:col-span-2 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{b.batchNumber}</span>
                      {statusBadge(b.status)}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{b.operator} · {b.scanner}</p>
                  </div>
                  <div className="text-xs">
                    <div className="text-gray-400">Pages</div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{b.actualPages.toLocaleString()} / {b.expectedPages.toLocaleString()}</div>
                  </div>
                  <div className="text-xs">
                    <div className="text-gray-400">Pass rate</div>
                    <div className="font-medium text-emerald-700 dark:text-emerald-400">{passRate.toFixed(1)}%</div>
                  </div>
                  <div className="text-xs">
                    <div className="text-gray-400">Illegible</div>
                    <div className={`font-medium ${illegibility > 5 ? "text-red-700 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}>{illegibility.toFixed(1)}%</div>
                  </div>
                  <div className="text-xs text-right">
                    <Link href={`/admin/digitisation?focus=${b.id}`} className="text-karu-green hover:underline">Manage in batches tab →</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" | "default" }) {
  const cls =
    accent === "green"
      ? "text-emerald-700 dark:text-emerald-400"
      : accent === "red"
      ? "text-red-700 dark:text-red-400"
      : "text-gray-900 dark:text-gray-100";
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
