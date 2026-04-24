"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Summary {
  total: number;
  completed: number;
  rejected: number;
  cancelled: number;
  inProgress: number;
  completionRate: number;
  avgCycleDays: number;
}

interface TemplateRow {
  templateId: string;
  templateName: string;
  total: number;
  completed: number;
  rejected: number;
  completionRate: number;
  avgCycleDays: number;
}

interface StepRow {
  stepName: string;
  avgCompletionHours: number;
  taskCount: number;
  breachRate: number;
}

interface AssigneeRow {
  assigneeId: string;
  assigneeName: string;
  tasksCompleted: number;
  tasksBreached: number;
  breachRate: number;
}

interface PeakLoad {
  byDayOfWeek: { day: string; count: number }[];
  byHourOfDay: { hour: number; count: number }[];
}

interface FunnelStep {
  stepIndex: number;
  stepName: string;
  reached: number;
  reachRate: number;
}

interface Analytics {
  period: { from: string; to: string };
  summary: Summary;
  byTemplate: TemplateRow[];
  byStep: StepRow[];
  slaBreachRate: AssigneeRow[];
  peakLoad: PeakLoad;
  funnelCompletion: FunnelStep[];
}

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-gray-800 mb-3">{children}</h2>;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function WorkflowAnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } catch { /* non-critical */ }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (templateId) params.set("templateId", templateId);
      const res = await fetch(`/api/workflows/analytics?${params}`);
      if (!res.ok) throw new Error("Failed to load analytics");
      const data = await res.json();
      setAnalytics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [from, to, templateId]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Loading analytics…
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="p-8 text-red-600 text-sm">{error ?? "No data"}</div>
    );
  }

  const { summary, byTemplate, byStep, slaBreachRate, peakLoad, funnelCompletion } = analytics;

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Workflow Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Process performance and SLA insights</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={loadAnalytics}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="In Progress" value={summary.inProgress} color="text-blue-600" />
        <KpiCard label="Completed" value={summary.completed} color="text-green-600" />
        <KpiCard label="Rejected" value={summary.rejected} color="text-red-600" />
        <KpiCard label="Cancelled" value={summary.cancelled} color="text-gray-500" />
        <KpiCard
          label="Completion Rate"
          value={`${summary.completionRate}%`}
          color={summary.completionRate >= 80 ? "text-green-600" : "text-amber-600"}
        />
        <KpiCard
          label="Avg Cycle Time"
          value={`${summary.avgCycleDays}d`}
          sub="calendar days"
          color="text-purple-600"
        />
      </div>

      {/* Per-template breakdown */}
      {byTemplate.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <SectionTitle>Performance by Template</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byTemplate} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="templateName"
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="completed" name="Completed" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="rejected" name="Rejected" fill="#dc2626" radius={[3, 3, 0, 0]} />
              <Bar dataKey="inProgress" name="In Progress" fill="#2563eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Avg completion time per step */}
        {byStep.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionTitle>Avg Completion Time by Step (hours)</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={byStep.slice(0, 10)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="stepName" type="category" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v}h`, "Avg time"]} />
                <Bar dataKey="avgCompletionHours" fill="#7c3aed" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Funnel completion */}
        {funnelCompletion.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionTitle>Funnel Completion Rate</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={funnelCompletion} margin={{ top: 4, right: 24, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="stepName"
                  tick={{ fontSize: 11 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`, "Reach rate"]} />
                <Line
                  type="monotone"
                  dataKey="reachRate"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SLA breach rate per assignee */}
        {slaBreachRate.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionTitle>SLA Breach Rate by Assignee</SectionTitle>
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">Assignee</th>
                    <th className="text-right py-2 pr-4 font-medium text-gray-500">Completed</th>
                    <th className="text-right py-2 pr-4 font-medium text-gray-500">Breached</th>
                    <th className="text-right py-2 font-medium text-gray-500">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {slaBreachRate.map((row) => (
                    <tr key={row.assigneeId} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 text-gray-900">{row.assigneeName}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.tasksCompleted}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.tasksBreached}</td>
                      <td className="py-2 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            row.breachRate === 0
                              ? "bg-green-50 text-green-700"
                              : row.breachRate < 25
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {row.breachRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Peak load by day of week */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <SectionTitle>Task Volume by Day of Week</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={peakLoad.byDayOfWeek} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Tasks" fill="#0891b2" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <SectionTitle>Peak Hours</SectionTitle>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={peakLoad.byHourOfDay} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
              <Bar dataKey="count" fill="#7c3aed" radius={[2, 2, 0, 0]} />
              <Tooltip formatter={(v) => [v, "Tasks"]} labelFormatter={(h) => `${h}:00`} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-template detail table */}
      {byTemplate.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <SectionTitle>Template Detail</SectionTitle>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {["Template", "Total", "Completed", "Rejected", "Completion %", "Avg Cycle"].map((h) => (
                    <th key={h} className="text-left py-2 pr-6 font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byTemplate.map((row) => (
                  <tr key={row.templateId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-6 font-medium text-gray-900">{row.templateName}</td>
                    <td className="py-2 pr-6 text-gray-600">{row.total}</td>
                    <td className="py-2 pr-6 text-green-700">{row.completed}</td>
                    <td className="py-2 pr-6 text-red-600">{row.rejected}</td>
                    <td className="py-2 pr-6">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[80px]">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${row.completionRate}%` }}
                          />
                        </div>
                        <span className="text-gray-700 font-medium">{row.completionRate}%</span>
                      </div>
                    </td>
                    <td className="py-2 pr-6 text-purple-700">{row.avgCycleDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
