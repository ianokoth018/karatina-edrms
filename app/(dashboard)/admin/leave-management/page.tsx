"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import type { CarryForwardRule, CarryForwardResult } from "@/app/api/admin/form-data/carry-forward/route";
import type { InitializeResult, InitPreviewRow } from "@/app/api/admin/leave-management/initialize/route";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveTypeRecord {
  id: string;
  data: {
    leave_type?: string;
    days_allocated?: number;
    gender?: string;
  };
}

interface BalanceSummary {
  year: number;
  count: number;
  leaveTypes: string[];
}

interface SchemaRef { id: string; slug: string; name: string }

// ─── Style constants ──────────────────────────────────────────────────────────

const inputCls =
  "w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none transition-colors";
const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1";
const btnPrimary =
  "px-4 py-2 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50";

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeaveManagementPage() {
  const { can } = usePermissions();

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [balanceSummaries, setBalanceSummaries] = useState<BalanceSummary[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Schema refs for direct links
  const [typesSchema, setTypesSchema] = useState<SchemaRef | null>(null);
  const [balancesSchema, setBalancesSchema] = useState<SchemaRef | null>(null);

  // Form state
  const currentYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState(currentYear);
  const [toYear, setToYear] = useState(currentYear + 1);
  const [rules, setRules] = useState<CarryForwardRule[]>([]);

  // Carry-forward operation state
  const [previewResult, setPreviewResult] = useState<CarryForwardResult | null>(null);
  const [runResult, setRunResult] = useState<CarryForwardResult | null>(null);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Initialize balances state
  const [initYear, setInitYear] = useState(currentYear);
  const [initDepartment, setInitDepartment] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [initPreviewing, setInitPreviewing] = useState(false);
  const [initRunning, setInitRunning] = useState(false);
  const [initPreview, setInitPreview] = useState<InitializeResult | null>(null);
  const [initResult, setInitResult] = useState<InitializeResult | null>(null);
  const [initConfirmOpen, setInitConfirmOpen] = useState(false);

  const isAdmin = can("admin:manage");

  // ── Load leave types and balance summaries ───────────────────────────────

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const schemasRes = await fetch("/api/admin/form-data");
      if (!schemasRes.ok) throw new Error("Failed to load datasets");
      const { schemas } = await schemasRes.json();

      // slugs use underscores in the DB
      const tSchema: SchemaRef | undefined = schemas.find(
        (s: SchemaRef) => s.slug === "leave_types" || s.slug === "leave-types"
      );
      const bSchema: SchemaRef | undefined = schemas.find(
        (s: SchemaRef) => s.slug === "leave_balances" || s.slug === "leave-balances"
      );

      setTypesSchema(tSchema ?? null);
      setBalancesSchema(bSchema ?? null);

      if (tSchema) {
        const typesRes = await fetch(`/api/admin/form-data/${tSchema.id}/records`);
        if (typesRes.ok) {
          const { records } = await typesRes.json();
          setLeaveTypes(records ?? []);
          setRules((prev) => {
            if (prev.length > 0) return prev;
            return (records ?? [])
              .map((r: LeaveTypeRecord) => ({
                leaveType: r.data.leave_type ?? "",
                enabled: r.data.leave_type === "Annual Leave",
                cap: r.data.leave_type === "Annual Leave" ? 10 : 0,
              }))
              .filter((r: CarryForwardRule) => r.leaveType);
          });
        }
      }

      if (bSchema) {
        const balRes = await fetch(`/api/admin/form-data/${bSchema.id}/records?limit=2000`);
        if (balRes.ok) {
          const { records } = await balRes.json();
          const byYear = new Map<number, { count: number; types: Set<string> }>();
          for (const r of (records ?? []) as { data: { year?: number; leave_type?: string } }[]) {
            const y = Number(r.data?.year ?? 0);
            if (!y) continue;
            if (!byYear.has(y)) byYear.set(y, { count: 0, types: new Set() });
            const entry = byYear.get(y)!;
            entry.count++;
            if (r.data?.leave_type) entry.types.add(r.data.leave_type);
          }
          const summaries: BalanceSummary[] = Array.from(byYear.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([year, v]) => ({ year, count: v.count, leaveTypes: Array.from(v.types) }));
          setBalanceSummaries(summaries);
        }
      }
      // Load distinct departments for the department filter
      const deptsRes = await fetch("/api/users/search?departments=true");
      if (deptsRes.ok) {
        const { departments: deptList } = await deptsRes.json();
        setDepartments(
          (deptList as { department: string }[]).map((d) => d.department).filter(Boolean)
        );
      }
    } catch (err) {
      setDataError(String(err));
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function updateRule(leaveType: string, patch: Partial<CarryForwardRule>) {
    setRules((prev) => prev.map((r) => r.leaveType === leaveType ? { ...r, ...patch } : r));
  }

  async function runCarryForward(dryRun: boolean) {
    if (dryRun) setPreviewing(true);
    else setRunning(true);
    try {
      const res = await fetch("/api/admin/form-data/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromYear, toYear,
          balancesSlug: balancesSchema?.slug ?? "leave_balances",
          typesSlug: typesSchema?.slug ?? "leave_types",
          rules, dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Carry-forward failed");
      if (dryRun) {
        setPreviewResult(data.result);
      } else {
        setRunResult(data.result);
        setConfirmOpen(false);
        setPreviewResult(null);
        await loadData();
      }
    } catch (err) {
      alert(String(err));
    } finally {
      setPreviewing(false);
      setRunning(false);
    }
  }

  async function runInitialize(dryRun: boolean) {
    if (dryRun) setInitPreviewing(true);
    else setInitRunning(true);
    try {
      const res = await fetch("/api/admin/leave-management/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: initYear,
          balancesSlug: balancesSchema?.slug ?? "leave_balances",
          typesSlug: typesSchema?.slug ?? "leave_types",
          department: initDepartment || undefined,
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Initialization failed");
      if (dryRun) {
        setInitPreview(data.result);
      } else {
        setInitResult(data.result);
        setInitConfirmOpen(false);
        setInitPreview(null);
        await loadData();
      }
    } catch (err) {
      alert(String(err));
    } finally {
      setInitPreviewing(false);
      setInitRunning(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const hasLeaveTypes = leaveTypes.length > 0;
  const hasBalances = balanceSummaries.length > 0;
  const isReady = hasLeaveTypes && hasBalances;

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Leave Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure leave types, declare staff leave balances, and run the year-end carry-forward rollover.
        </p>
      </div>

      {/* ── GETTING STARTED GUIDE ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
          <svg className="w-4 h-4 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Setup Guide — 3 Steps to Get Started</h2>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Step 1 */}
          <div className={`flex gap-4 px-5 py-4 ${hasLeaveTypes ? "opacity-60" : ""}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              hasLeaveTypes ? "bg-karu-green text-white" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-2 border-amber-300 dark:border-amber-700"
            }`}>
              {hasLeaveTypes ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : "1"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Declare Leave Types
                {hasLeaveTypes && <span className="ml-2 text-xs font-normal text-karu-green">{leaveTypes.length} types configured</span>}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Define each leave category (Annual Leave, Sick Leave, Maternity Leave, etc.) with their base day allocations.
                {!hasLeaveTypes && " This must be done before entering any balances."}
              </p>
              {typesSchema && (
                <Link
                  href={`/admin/form-data/${typesSchema.id}`}
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-karu-green hover:underline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  {hasLeaveTypes ? "View / edit Leave Types →" : "Go to Leave Types dataset →"}
                </Link>
              )}
              {!typesSchema && (
                <Link href="/admin/form-data" className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-karu-green hover:underline">
                  Create Leave Types dataset in Form Data →
                </Link>
              )}
            </div>
          </div>

          {/* Step 2 */}
          <div className={`flex gap-4 px-5 py-4 ${hasBalances ? "opacity-60" : ""}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              hasBalances ? "bg-karu-green text-white" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-2 border-amber-300 dark:border-amber-700"
            }`}>
              {hasBalances ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : "2"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Enter Staff Leave Balances
                {hasBalances && (
                  <span className="ml-2 text-xs font-normal text-karu-green">
                    {balanceSummaries.reduce((s, r) => s + r.count, 0)} records across {balanceSummaries.length} year{balanceSummaries.length > 1 ? "s" : ""}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                For each staff member, add one row per leave type per year. Fill in: <strong>Employee ID</strong>, <strong>Staff Number</strong>, <strong>Leave Type</strong>, <strong>Days Allocated</strong>, <strong>Days Used</strong> (0 for new year), <strong>Days Remaining</strong>, <strong>Year</strong>.
              </p>
              {balancesSchema && (
                <Link
                  href={`/admin/form-data/${balancesSchema.id}`}
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-karu-green hover:underline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  {hasBalances ? "View / edit Leave Balances →" : "Go to Leave Balances dataset → Add Row for each staff member"}
                </Link>
              )}
              {!balancesSchema && (
                <Link href="/admin/form-data" className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-karu-green hover:underline">
                  Create Leave Balances dataset in Form Data →
                </Link>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className={`flex gap-4 px-5 py-4 ${!isReady ? "opacity-40" : ""}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              isReady ? "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-2 border-gray-300 dark:border-gray-600" : "bg-gray-100 dark:bg-gray-800 text-gray-400 border-2 border-gray-200 dark:border-gray-700"
            }`}>
              3
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Year-End Carry-Forward <span className="text-xs font-normal text-gray-500">(annual — when needed)</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                At the end of each year, use the tool below to automatically roll over unused leave days into the new year according to configured rules. This reads from your balances above and creates new records.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── BALANCE INVENTORY ───────────────────────────────────────────────── */}
      {hasBalances && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Leave Balance Inventory</h2>
            {balancesSchema && (
              <Link href={`/admin/form-data/${balancesSchema.id}`} className="text-xs text-karu-green hover:underline">
                Manage records →
              </Link>
            )}
          </div>
          {loadingData ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : dataError ? (
            <p className="text-sm text-red-500">{dataError}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Year</th>
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Staff Records</th>
                    <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Leave Types Covered</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceSummaries.map((s) => (
                    <tr key={s.year} className="border-b border-gray-50 dark:border-gray-800/50">
                      <td className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">{s.year}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{s.count}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {s.leaveTypes.map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">{t}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── INITIALIZE BALANCES FOR ALL STAFF ───────────────────────────────── */}
      <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-5 ${!hasLeaveTypes ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Initialize Balances for All Staff</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Auto-generate leave balance records for every active staff member in the database.
              Creates one record per person per leave type (gender-neutral types only).
            </p>
          </div>
          {!hasLeaveTypes && (
            <span className="flex-shrink-0 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full">
              Configure leave types first
            </span>
          )}
        </div>

        {/* Year + department */}
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className={labelCls}>Year</label>
            <input
              type="number"
              value={initYear}
              onChange={(e) => setInitYear(parseInt(e.target.value) || currentYear)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Department <span className="text-gray-400 font-normal">(optional)</span></label>
            <select
              value={initDepartment}
              onChange={(e) => setInitDepartment(e.target.value)}
              className={inputCls}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Info note about gender-specific types */}
        {leaveTypes.some((t) => t.data.gender && t.data.gender !== "Any") && (
          <div className="flex gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              <strong>Gender-specific leave types</strong> (
              {leaveTypes.filter((t) => t.data.gender && t.data.gender !== "Any").map((t) => t.data.leave_type).join(", ")}
              ) are not assigned in bulk — the system has no gender field on user accounts.
              Assign these manually from the Leave Balances dataset.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => runInitialize(true)}
            disabled={initPreviewing || initRunning || !hasLeaveTypes}
            className={btnSecondary}
          >
            {initPreviewing ? "Generating preview..." : "Preview (dry run)"}
          </button>
          <button
            type="button"
            onClick={() => setInitConfirmOpen(true)}
            disabled={initRunning || initPreviewing || !hasLeaveTypes}
            className={btnPrimary}
          >
            Initialize Balances
          </button>
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            <strong>Idempotent:</strong> Any staff + leave type combination that already has a {initYear} record is skipped.
            Safe to re-run for new hires or after adding leave types. Use <strong>Preview</strong> first.
          </p>
        </div>
      </div>

      {/* Initialize preview */}
      {initPreview && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Initialize Preview — {initYear}{initDepartment ? ` · ${initDepartment}` : ""}
            </h2>
            <div className="flex gap-3 text-xs flex-wrap">
              <span className="text-gray-500">{initPreview.usersFound} users · {initPreview.leaveTypesFound} leave types</span>
              <span className="text-green-600 font-medium">{initPreview.created} to create</span>
              <span className="text-gray-400">{initPreview.skipped} to skip</span>
              {initPreview.genderSkipped > 0 && (
                <span className="text-blue-500">{initPreview.genderSkipped} type{initPreview.genderSkipped > 1 ? "s" : ""} gender-skipped</span>
              )}
            </div>
          </div>

          {(initPreview.preview?.length ?? 0) > 0 && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Employee ID</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Department</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Leave Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {(initPreview.preview as InitPreviewRow[]).map((row, i) => (
                    <tr key={i} className="border-t border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{row.employeeId || "—"}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.displayName}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.department || "—"}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.leaveType}</td>
                      <td className="px-3 py-2 text-right font-semibold text-karu-green">{row.daysAllocated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setInitConfirmOpen(true)} className={btnPrimary}>
              Looks good — Initialize now
            </button>
            <button type="button" onClick={() => setInitPreview(null)} className={btnSecondary}>
              Discard preview
            </button>
          </div>
        </div>
      )}

      {/* Initialize run result */}
      {initResult && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-green-200 dark:border-green-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">Initialization Complete — {initYear}</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Staff processed", value: initResult.usersFound },
              { label: "Records created", value: initResult.created, green: true },
              { label: "Skipped (existing)", value: initResult.skipped },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className={`text-2xl font-bold ${s.green ? "text-karu-green" : "text-gray-900 dark:text-gray-100"}`}>{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          {initResult.errors > 0 && (
            <p className="text-sm text-red-500">{initResult.errors} errors — check the detail log.</p>
          )}
          {initResult.genderSkipped > 0 && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {initResult.genderSkipped} gender-specific leave type{initResult.genderSkipped > 1 ? "s" : ""} skipped — assign these manually.
            </p>
          )}
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">Detail log ({initResult.detail.length} entries)</summary>
            <div className="mt-2 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono leading-5 space-y-0.5">
              {initResult.detail.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </details>
          <button type="button" onClick={() => setInitResult(null)} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {/* Initialize confirm modal */}
      {initConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Initialize Leave Balances</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will create <strong>{initYear}</strong> leave balance records for all active staff
              {initDepartment ? <> in <strong>{initDepartment}</strong></> : ""}.
              {initPreview && (
                <> <strong>{initPreview.created}</strong> new records will be written.</>
              )}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Existing records for the same staff + leave type + year are skipped automatically.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => runInitialize(false)}
                disabled={initRunning}
                className={`${btnPrimary} flex-1`}
              >
                {initRunning ? "Initializing..." : "Yes, initialize balances"}
              </button>
              <button
                type="button"
                onClick={() => setInitConfirmOpen(false)}
                disabled={initRunning}
                className={btnSecondary}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CARRY-FORWARD TOOL ──────────────────────────────────────────────── */}
      <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-5 ${!isReady ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Year-End Carry-Forward</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Creates new leave balance records for each staff member in the target year, carrying unused days forward according to the rules below.
            </p>
          </div>
          {!isReady && (
            <span className="flex-shrink-0 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full">
              Complete steps 1 &amp; 2 first
            </span>
          )}
        </div>

        {/* Year selectors */}
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className={labelCls}>From Year</label>
            <input type="number" value={fromYear} onChange={(e) => setFromYear(parseInt(e.target.value) || currentYear)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>To Year</label>
            <input type="number" value={toYear} onChange={(e) => setToYear(parseInt(e.target.value) || currentYear + 1)} className={inputCls} />
          </div>
        </div>

        {/* Rules */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Rules per Leave Type</h3>
          {rules.length === 0 ? (
            <p className="text-sm text-gray-400">No leave types configured yet.</p>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const typeRecord = leaveTypes.find((t) => t.data.leave_type === rule.leaveType);
                const baseAlloc = typeRecord?.data.days_allocated ?? 0;
                const gender = typeRecord?.data.gender ?? "Any";
                return (
                  <div key={rule.leaveType} className={`flex flex-wrap items-center gap-4 p-3 rounded-xl border transition-colors ${
                    rule.enabled ? "border-karu-green/30 bg-karu-green/5" : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40"
                  }`}>
                    <button type="button" onClick={() => updateRule(rule.leaveType, { enabled: !rule.enabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${rule.enabled ? "bg-karu-green" : "bg-gray-300 dark:bg-gray-600"}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{rule.leaveType}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Base: {baseAlloc} days · Gender: {gender}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Carry-forward cap</label>
                      <input type="number" min={0} max={baseAlloc} value={rule.cap} disabled={!rule.enabled}
                        onChange={(e) => updateRule(rule.leaveType, { cap: parseInt(e.target.value) || 0 })}
                        className="w-16 h-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-center outline-none disabled:opacity-40" />
                      <span className="text-xs text-gray-400">days max</span>
                    </div>
                    {rule.enabled && (
                      <span className="flex-shrink-0 text-xs text-karu-green font-medium">
                        {baseAlloc} + up to {rule.cap} = up to {baseAlloc + rule.cap} days
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={() => runCarryForward(true)}
            disabled={previewing || running || rules.length === 0} className={btnSecondary}>
            {previewing ? "Generating preview..." : "Preview (dry run)"}
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)}
            disabled={running || previewing || rules.length === 0} className={btnPrimary}>
            Run Carry-Forward
          </button>
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            <strong>Safety:</strong> Carry-forward only creates <em>new</em> records for {toYear}. Existing {toYear} records for the same staff number + leave type are skipped — safe to re-run. Use <strong>Preview</strong> first to review every record before writing.
          </p>
        </div>
      </div>

      {/* Preview results */}
      {previewResult && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Preview — {fromYear} → {toYear}</h2>
            <div className="flex gap-3 text-xs">
              <span className="text-green-600 font-medium">{previewResult.created} to create</span>
              <span className="text-gray-400">{previewResult.skipped} to skip</span>
              {previewResult.errors > 0 && <span className="text-red-500">{previewResult.errors} errors</span>}
            </div>
          </div>
          {(previewResult.preview?.length ?? 0) > 0 && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Staff No.</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-500">Leave Type</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">{fromYear} Remaining</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">Carry Forward</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-500">{toYear} Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.preview!.map((row, i) => (
                    <tr key={i} className="border-t border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{row.staffNumber}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.leaveType}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{row.daysRemaining2026}</td>
                      <td className="px-3 py-2 text-right">
                        {row.carryForward > 0
                          ? <span className="text-karu-green font-semibold">+{row.carryForward}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{row.newAllocation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirmOpen(true)} className={btnPrimary}>Looks good — Run now</button>
            <button type="button" onClick={() => setPreviewResult(null)} className={btnSecondary}>Discard preview</button>
          </div>
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-green-200 dark:border-green-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">Carry-Forward Complete</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Records processed", value: runResult.processed },
              { label: "New records created", value: runResult.created, green: true },
              { label: "Skipped", value: runResult.skipped },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className={`text-2xl font-bold ${s.green ? "text-karu-green" : "text-gray-900 dark:text-gray-100"}`}>{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          {runResult.errors > 0 && <p className="text-sm text-red-500">{runResult.errors} errors — check the detail log.</p>}
          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">Detail log ({runResult.detail.length} entries)</summary>
            <div className="mt-2 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono leading-5 space-y-0.5">
              {runResult.detail.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </details>
          <button type="button" onClick={() => setRunResult(null)} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Confirm Carry-Forward</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will create leave balance records for <strong>{toYear}</strong> based on {fromYear} balances.
              {rules.filter((r) => r.enabled).length > 0 && (
                <> Carry-forward enabled for: <strong>{rules.filter((r) => r.enabled).map((r) => `${r.leaveType} (max ${r.cap} days)`).join(", ")}</strong>.</>
              )}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">Existing {toYear} records will be skipped. This action is audited.</p>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => runCarryForward(false)} disabled={running} className={`${btnPrimary} flex-1`}>
                {running ? "Running..." : "Yes, run carry-forward"}
              </button>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={running} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
