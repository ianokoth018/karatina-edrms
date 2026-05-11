"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface Props {
  params: Promise<{ slug: string }>;
}

interface Instance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  initiatedBy?: { name: string };
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  IN_PROGRESS: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  COMPLETED: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  REJECTED: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  CANCELLED: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

export default function WorkflowTracePage({ params }: Props) {
  const { slug } = use(params);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const sidebarRes = await fetch("/api/workflows/sidebar");
      if (!sidebarRes.ok) { setLoading(false); return; }
      const { modules } = await sidebarRes.json();
      const mod = (modules as { slug: string; id: string }[]).find((m) => m.slug === slug);
      if (!mod) { setLoading(false); return; }

      const res = await fetch(`/api/workflows?templateId=${mod.id}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setInstances(data.instances ?? []);
      setLoading(false);
    }
    load();
  }, [slug]);

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

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Trace an Instance</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {instances.length} instance{instances.length !== 1 ? "s" : ""} total
        </p>
      </div>

      {instances.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No instances yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {instances.map((inst) => (
            <Link
              key={inst.id}
              href={`/workflows/${inst.id}`}
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-[#02773b]/40 hover:shadow-sm transition-all"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inst.subject}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {inst.referenceNumber}
                  {inst.initiatedBy ? ` · ${inst.initiatedBy.name}` : ""}
                  {" · "}
                  {new Date(inst.startedAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-lg flex-shrink-0 ${STATUS_STYLES[inst.status] ?? STATUS_STYLES.PENDING}`}>
                {inst.status.replace(/_/g, " ")}
              </span>
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
