"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ReviewPanel } from "@/components/forms/review-panel";
import type { FormField } from "@/components/forms/form-renderer";

interface Props {
  params: Promise<{ instanceId: string }>;
}

interface TaskRecord {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment: string | null;
  dueAt: string | null;
  assignedAt: string;
  completedAt: string | null;
  assignee: { id: string; name: string; displayName: string | null; email: string } | null;
}

interface TemplateNode {
  id: string;
  type: string;
  data: { formTemplateId?: string; [key: string]: unknown };
}

interface Instance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  dueAt: string | null;
  formData: Record<string, unknown>;
  template: {
    id: string; name: string; description: string | null;
    definition: { nodes?: TemplateNode[] } | null;
  };
  initiatedBy: { id: string; name: string; displayName: string | null; email: string; department: string | null } | null;
  document: { id: string; title: string; referenceNumber: string } | null;
  tasks: TaskRecord[];
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  IN_PROGRESS: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
  COMPLETED: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  REJECTED: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  CANCELLED: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function WorkflowInstancePage({ params }: Props) {
  const { instanceId } = use(params);
  const { data: session } = useSession();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workflows/${instanceId}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (d.error) { setError(d.error); return; }
        const inst: Instance = d.instance;
        setInstance(inst);

        // Find the formTemplateId from the workflow template's task nodes
        const nodes = inst.template.definition?.nodes ?? [];
        const formTemplateId = nodes
          .filter((n) => n.type === "taskNode" || n.data?.formTemplateId)
          .map((n) => n.data?.formTemplateId)
          .find(Boolean);

        if (formTemplateId) {
          const fr = await fetch(`/api/forms/${formTemplateId}`);
          if (fr.ok) {
            const fd = await fr.json();
            setFormFields(fd.fields ?? []);
          }
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [instanceId]);

  // ReviewPanel requires isVisible — in trace mode, show all non-layout fields
  const isVisible = useCallback((f: FormField) => {
    return !["section", "divider", "step"].includes(f.type);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className="max-w-2xl py-16 text-center">
        <p className="text-sm text-red-500">{error ?? "Instance not found"}</p>
        <Link href="/workflows" className="mt-4 inline-block text-sm text-[#02773b] hover:underline">Back</Link>
      </div>
    );
  }

  const userId = session?.user?.id;
  const isInitiator = instance.initiatedBy?.id === userId;
  const myPendingTask = instance.tasks.find(
    (t) => t.status === "PENDING" && (t.assignee?.id === userId)
  );

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              {instance.referenceNumber}
            </p>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {instance.subject}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{instance.template.name}</p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full flex-shrink-0 ${STATUS_STYLES[instance.status] ?? STATUS_STYLES.PENDING}`}>
            {instance.status.replace(/_/g, " ")}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Submitted by</p>
            <p className="text-gray-700 dark:text-gray-300 mt-0.5">
              {instance.initiatedBy ? (instance.initiatedBy.displayName ?? instance.initiatedBy.name) : "—"}
            </p>
          </div>
          {instance.initiatedBy?.department && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Department</p>
              <p className="text-gray-700 dark:text-gray-300 mt-0.5">{instance.initiatedBy.department}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Started</p>
            <p className="text-gray-700 dark:text-gray-300 mt-0.5">{fmt(instance.startedAt)}</p>
          </div>
          {instance.completedAt && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Completed</p>
              <p className="text-gray-700 dark:text-gray-300 mt-0.5">{fmt(instance.completedAt)}</p>
            </div>
          )}
          {instance.document && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Document</p>
              <Link href={`/documents/${instance.document.id}`} className="text-[#02773b] hover:underline mt-0.5 block">
                {instance.document.referenceNumber}
              </Link>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-2">
          {myPendingTask && (
            <Link
              href={`/workflows/tasks/${myPendingTask.id}`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#026332] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
              {isInitiator ? "Continue & Submit" : `Action: ${myPendingTask.stepName}`}
            </Link>
          )}
          <button
            type="button"
            onClick={() => history.back()}
            className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Form data — read-only using the original form layout */}
      {formFields.length > 0 ? (
        <ReviewPanel
          fields={formFields}
          formData={instance.formData}
          isVisible={isVisible}
          onEdit={() => {}}
          readOnly
        />
      ) : Object.keys(instance.formData ?? {}).length > 0 ? (
        // Fallback: no form template found, show raw key-value
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Request Details</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {Object.entries(instance.formData).filter(([, v]) => v != null && v !== "").map(([key, value]) => (
              <div key={key} className="grid grid-cols-2 gap-3 px-5 py-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide self-center">
                  {key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
                <span className="text-sm text-gray-900 dark:text-gray-100">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Approval trail */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Approval Trail</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {instance.tasks.map((task, i) => (
            <div key={task.id} className="flex gap-4 px-5 py-4">
              <div className={`mt-0.5 w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
                ${task.status === "COMPLETED" ? "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400" :
                  task.status === "REJECTED" ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400" :
                  task.status === "PENDING" ? "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400" :
                  "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}
              >
                {task.status === "COMPLETED" ? "✓" : task.status === "REJECTED" ? "✕" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{task.stepName}</p>
                  <div className="flex items-center gap-2">
                    {task.action ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        task.action === "APPROVED" ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" :
                        task.action === "REJECTED" ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" :
                        "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      }`}>
                        {task.action.replace(/_/g, " ")}
                      </span>
                    ) : task.status === "PENDING" ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                        Awaiting action
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1 space-y-0.5">
                  {task.assignee ? (
                    <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                      {task.assignee.displayName ?? task.assignee.name}
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-normal ml-1.5">
                        {task.assignee.email}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">Unassigned / Pool task</p>
                  )}
                  {task.completedAt && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{fmt(task.completedAt)}</p>
                  )}
                  {!task.completedAt && task.status === "PENDING" && task.dueAt && (
                    <p className={`text-xs ${new Date(task.dueAt) < new Date() ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}>
                      Due {fmt(task.dueAt)}
                    </p>
                  )}
                  {task.comment && (
                    <p className="text-sm italic text-gray-500 dark:text-gray-400 mt-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                      &ldquo;{task.comment}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {instance.tasks.length === 0 && (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">No approvers assigned yet.</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Check the workflow template configuration.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
