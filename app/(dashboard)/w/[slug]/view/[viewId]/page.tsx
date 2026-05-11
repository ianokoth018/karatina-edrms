"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface Props {
  params: Promise<{ slug: string; viewId: string }>;
}

interface CustomView {
  id: string;
  label: string;
  description?: string;
  filter: string;
}

interface Instance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  dueAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  IN_PROGRESS: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  COMPLETED: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  REJECTED: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  CANCELLED: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

export default function WorkflowCustomViewPage({ params }: Props) {
  const { slug, viewId } = use(params);
  const [view, setView] = useState<CustomView | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const sidebarRes = await fetch("/api/workflows/sidebar");
        if (!sidebarRes.ok) throw new Error("Failed to load module");
        const { modules } = await sidebarRes.json();
        const mod = (modules as { slug: string; id: string; customQueries: unknown[] }[]).find((m) => m.slug === slug);
        if (!mod) { setError("Workflow module not found"); setLoading(false); return; }

        const foundView = (mod.customQueries as CustomView[]).find((q) => q.id === viewId);
        if (!foundView) { setError("Custom view not found"); setLoading(false); return; }
        setView(foundView);

        // Build query params based on filter
        const params = new URLSearchParams({ templateId: mod.id, limit: "100" });
        const filter = foundView.filter;

        if (filter === "mine") {
          params.set("mine", "true");
        } else if (filter === "mine_pending") {
          params.set("mine", "true");
          params.set("status", "IN_PROGRESS");
        } else if (filter === "assigned_to_me") {
          params.set("assignedToMe", "true");
        } else if (filter.startsWith("status:")) {
          params.set("status", filter.slice(7));
        } else if (filter.startsWith("step:")) {
          params.set("stepName", filter.slice(5));
        }
        // "all" and "overdue" fetch without extra filters (overdue refined client-side)

        const res = await fetch(`/api/workflows?${params}`);
        if (!res.ok) throw new Error("Failed to fetch instances");
        const data = await res.json();
        let results: Instance[] = data.instances ?? [];

        // Client-side refinement for overdue (needs dueAt comparison)
        if (filter === "overdue") {
          const now = new Date();
          results = results.filter(
            (i) => i.dueAt && new Date(i.dueAt) < now && i.status !== "COMPLETED" && i.status !== "CANCELLED"
          );
        }

        setInstances(results);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug, viewId]);

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

  if (error) {
    return (
      <div className="max-w-4xl">
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{view?.label}</h2>
        {view?.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{view.description}</p>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {instances.length} instance{instances.length !== 1 ? "s" : ""}
        </p>
      </div>

      {instances.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No instances match this view</p>
        </div>
      ) : (
        <div className="space-y-2">
          {instances.map((inst) => {
            const isOverdue = inst.dueAt && new Date(inst.dueAt) < new Date() && inst.status !== "COMPLETED";
            return (
              <Link
                key={inst.id}
                href={`/workflows/${inst.id}`}
                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-[#02773b]/40 hover:shadow-sm transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inst.subject}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {inst.referenceNumber} · {new Date(inst.startedAt).toLocaleDateString()}
                    {isOverdue && <span className="ml-2 text-red-600 dark:text-red-400 font-medium">· Overdue</span>}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${STATUS_STYLES[inst.status] ?? STATUS_STYLES.PENDING}`}>
                  {inst.status.replace(/_/g, " ")}
                </span>
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
