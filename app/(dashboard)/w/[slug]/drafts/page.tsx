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
}

export default function WorkflowDraftsPage({ params }: Props) {
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

      const res = await fetch(`/api/workflows?templateId=${mod.id}&status=IN_PROGRESS`);
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
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Drafts</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Instances you started that are still in progress</p>
      </div>

      {instances.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No drafts</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Submitted instances awaiting approval will appear here</p>
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
                  {inst.referenceNumber} · Started {new Date(inst.startedAt).toLocaleDateString()}
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                {inst.status}
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
