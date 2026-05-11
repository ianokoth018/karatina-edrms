"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface Props {
  params: Promise<{ slug: string }>;
}

interface Task {
  id: string;
  stepName: string;
  status: string;
  dueAt: string | null;
  assignedAt: string;
  instance: {
    id: string;
    referenceNumber: string;
    subject: string;
    status: string;
    template: { id: string; name: string };
  };
}

export default function WorkflowInboxPage({ params }: Props) {
  const { slug } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const sidebarRes = await fetch("/api/workflows/sidebar");
      if (!sidebarRes.ok) { setLoading(false); return; }
      const { modules } = await sidebarRes.json();
      const mod = (modules as { slug: string; id: string }[]).find((m) => m.slug === slug);
      if (!mod) { setLoading(false); return; }
      setTemplateId(mod.id);

      const res = await fetch(`/api/workflows/tasks?status=PENDING&templateId=${mod.id}&limit=50`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setTasks(data.tasks ?? []);
      setLoading(false);
    }
    load();
  }, [slug]);

  const now = new Date();

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">My Inbox</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""} awaiting your action
          </p>
        </div>
        {templateId && (
          <Link
            href={`/w/${slug}/create`}
            className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#026332] transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New
          </Link>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No pending tasks</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">You&apos;re all caught up!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const overdue = task.dueAt && new Date(task.dueAt) < now;
            return (
              <Link
                key={task.id}
                href={`/workflows/${task.instance.id}`}
                className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-[#02773b]/40 hover:shadow-sm transition-all"
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${overdue ? "bg-red-500" : "bg-[#02773b]"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {task.instance.subject}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {task.stepName} · {task.instance.referenceNumber}
                  </p>
                </div>
                {task.dueAt && (
                  <span className={`text-xs flex-shrink-0 font-medium ${overdue ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {overdue ? "Overdue" : `Due ${new Date(task.dueAt).toLocaleDateString()}`}
                  </span>
                )}
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
