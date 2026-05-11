"use client";

import { useState, useEffect, use } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

interface Props {
  params: Promise<{ slug: string }>;
}

interface Analytics {
  period: { from: string; to: string };
  summary: {
    total: number;
    completed: number;
    rejected: number;
    cancelled: number;
    inProgress: number;
    completionRate: number;
    avgCycleDays: number;
  };
  byStep: { stepName: string; avgCompletionHours: number; taskCount: number; breachRate: number }[];
  funnelCompletion: { stepIndex: number; stepName: string; reached: number; reachRate: number }[];
  dailyTrend: { date: string; created: number; completed: number }[];
  peakLoad: { byDayOfWeek: { day: string; count: number }[] };
  slaBreachRate: { assigneeId: string; assigneeName: string; tasksCompleted: number; breachRate: number }[];
}

const PIE_COLORS = ["#22c55e", "#3b82f6", "#eab308", "#ef4444", "#94a3b8"];

export default function WorkflowModuleAnalyticsPage({ params }: Props) {
  const { slug } = use(params);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const sidebarRes = await fetch("/api/workflows/sidebar");
        if (!sidebarRes.ok) return;
        const { modules } = await sidebarRes.json();
        const mod = (modules as { slug: string; id: string }[]).find((m) => m.slug === slug);
        if (!mod) return;

        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const res = await fetch(`/api/workflows/analytics?templateId=${mod.id}&from=${from}`);
        if (!res.ok) return;
        setAnalytics(await res.json());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug, days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!analytics) {
    return <p className="text-sm text-gray-500">No analytics data available.</p>;
  }

  const { summary, byStep, funnelCompletion, dailyTrend, peakLoad, slaBreachRate } = analytics;

  const pieData = [
    { name: "Completed", value: summary.completed },
    { name: "In Progress", value: summary.inProgress },
    { name: "Pending", value: summary.total - summary.completed - summary.inProgress - summary.rejected - summary.cancelled },
    { name: "Rejected", value: summary.rejected },
    { name: "Cancelled", value: summary.cancelled },
  ].filter((d) => d.value > 0);

  // Trim daily trend to show only days that have any activity, plus surrounding context
  const trendData = dailyTrend.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    Created: d.created,
    Completed: d.completed,
  }));

  const kpis = [
    { label: "Total Instances", value: summary.total, color: "text-gray-900 dark:text-gray-100" },
    { label: "Completion Rate", value: `${summary.completionRate}%`, color: summary.completionRate >= 70 ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400" },
    { label: "Avg. Cycle Time", value: `${summary.avgCycleDays}d`, color: "text-gray-900 dark:text-gray-100" },
    { label: "In Progress", value: summary.inProgress, color: "text-blue-700 dark:text-blue-400" },
    { label: "Completed", value: summary.completed, color: "text-green-700 dark:text-green-400" },
    { label: "Rejected", value: summary.rejected, color: "text-red-700 dark:text-red-400" },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header + period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Analytics</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Workflow performance overview</p>
        </div>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                days === d
                  ? "bg-[#02773b] text-white"
                  : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-center">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Daily trend */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Instance Volume — Last {days} Days</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} interval={Math.floor(trendData.length / 8)} />
            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <Bar dataKey="Created" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Bar dataKey="Completed" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status distribution pie */}
        {pieData.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Status Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Peak load by day */}
        {peakLoad.byDayOfWeek.some((d) => d.count > 0) && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Peak Load by Day</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={peakLoad.byDayOfWeek} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={30} name="Tasks" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Step bottleneck table */}
      {byStep.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Step Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left pb-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Step</th>
                  <th className="text-right pb-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Time</th>
                  <th className="text-right pb-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                  <th className="text-right pb-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">SLA Breach</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {byStep.map((step) => {
                  const maxHours = Math.max(...byStep.map((s) => s.avgCompletionHours), 1);
                  const pct = Math.round((step.avgCompletionHours / maxHours) * 100);
                  return (
                    <tr key={step.stepName} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 rounded-full bg-[#02773b]/70 flex-shrink-0"
                            style={{ width: `${Math.max(pct, 4)}%`, maxWidth: 80 }}
                          />
                          <span className="text-gray-900 dark:text-gray-100 font-medium truncate">{step.stepName}</span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">
                        {step.avgCompletionHours >= 24
                          ? `${(step.avgCompletionHours / 24).toFixed(1)}d`
                          : `${step.avgCompletionHours}h`}
                      </td>
                      <td className="text-right py-2.5 text-gray-500 dark:text-gray-400 tabular-nums">{step.taskCount}</td>
                      <td className="text-right py-2.5 tabular-nums">
                        <span className={step.breachRate > 20 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-500 dark:text-gray-400"}>
                          {step.breachRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Funnel */}
      {funnelCompletion.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Workflow Funnel</h3>
          <div className="space-y-2">
            {funnelCompletion.map((step) => (
              <div key={step.stepIndex} className="flex items-center gap-3">
                <div className="w-32 text-xs text-gray-600 dark:text-gray-400 truncate">{step.stepName}</div>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-5 relative overflow-hidden">
                  <div
                    className="h-full bg-[#02773b] rounded-full transition-all"
                    style={{ width: `${step.reachRate}%` }}
                  />
                </div>
                <div className="w-20 text-right text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                  {step.reached} ({step.reachRate}%)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top SLA breach performers */}
      {slaBreachRate.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">SLA Performance by Assignee</h3>
          <div className="space-y-2">
            {slaBreachRate.slice(0, 8).map((row) => (
              <div key={row.assigneeId} className="flex items-center gap-3">
                <div className="w-36 text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{row.assigneeName}</div>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-4 relative overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${row.breachRate > 30 ? "bg-red-500" : row.breachRate > 10 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${row.breachRate}%` }}
                  />
                </div>
                <div className="w-24 text-right text-xs tabular-nums">
                  <span className={row.breachRate > 30 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-500 dark:text-gray-400"}>
                    {row.breachRate}% breach
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 ml-1">({row.tasksCompleted})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
