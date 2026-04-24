"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface PoolTask {
  id: string;
  stepName: string;
  dueAt: string | null;
  assignedAt: string;
  pool: { id: string; name: string } | null;
  instance: {
    id: string;
    referenceNumber: string;
    subject: string;
    template: { id: string; name: string };
    document: { id: string; title: string; referenceNumber: string } | null;
  };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dueLabel(dueAt: string | null): { text: string; cls: string } | null {
  if (!dueAt) return null;
  const hrs = (new Date(dueAt).getTime() - Date.now()) / 3600000;
  if (hrs < 0) return { text: `Overdue ${Math.abs(Math.round(hrs))}h`, cls: "text-red-600 dark:text-red-400" };
  if (hrs < 24) return { text: `Due in ${Math.round(hrs)}h`, cls: "text-amber-600 dark:text-amber-400" };
  return { text: `Due in ${Math.round(hrs / 24)}d`, cls: "text-gray-500 dark:text-gray-400" };
}

function IconSpinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export default function PoolTasksPage() {
  const [tasks, setTasks] = useState<PoolTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows/pool-tasks?limit=50");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function claimTask(taskId: string) {
    setClaiming(taskId);
    setClaimError(null);
    try {
      const res = await fetch(`/api/workflows/tasks/${taskId}/claim`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setClaimError(d.error ?? "Failed to claim task");
        return;
      }
      await load();
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pool Tasks</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Unclaimed tasks in your shared queues</p>
          </div>
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            Refresh
          </button>
        </div>

        {claimError && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-5 py-3">
            <p className="text-sm text-red-700 dark:text-red-400">{claimError}</p>
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5 h-20" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button onClick={load} className="mt-3 text-sm text-[#02773b] hover:underline">Retry</button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">No pool tasks available</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">All tasks in your queues have been claimed.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const due = dueLabel(task.dueAt);
              const isClaiming = claiming === task.id;
              return (
                <div
                  key={task.id}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden"
                >
                  <div className="h-0.5 bg-gradient-to-r from-[#02773b] to-[#dd9f42]" />
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-white bg-[#02773b] px-2 py-0.5 rounded-full">
                          {task.pool?.name ?? "Pool"}
                        </span>
                        <Link
                          href={`/workflows/${task.instance.id}`}
                          className="text-[10px] font-semibold text-[#02773b] dark:text-emerald-400 hover:underline"
                        >
                          {task.instance.referenceNumber}
                        </Link>
                        {due && (
                          <span className={`text-[10px] font-medium ${due.cls}`}>{due.text}</span>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {task.stepName}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {task.instance.subject}
                        {task.instance.document && <> &middot; {task.instance.document.title}</>}
                        <> &middot; {task.instance.template.name}</>
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        Added {timeAgo(task.assignedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => claimTask(task.id)}
                      disabled={isClaiming}
                      className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-60 shadow-sm transition-colors"
                    >
                      {isClaiming ? <IconSpinner className="w-4 h-4" /> : null}
                      {isClaiming ? "Claiming..." : "Claim"}
                    </button>
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
