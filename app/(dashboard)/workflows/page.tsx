"use client";

import { useState, useEffect, useCallback } from "react";

interface TaskDocument {
  id: string;
  title: string;
  referenceNumber: string;
  documentType: string;
  department: string;
}

interface TaskInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  template: { id: string; name: string };
  document: TaskDocument | null;
}

interface WorkflowTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment: string | null;
  dueAt: string | null;
  assignedAt: string;
  completedAt: string | null;
  instance: TaskInstance;
  assignee: { id: string; name: string; displayName: string; email: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type TabFilter = "PENDING" | "COMPLETED" | "all";

export default function WorkflowsPage() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [activeTab, setActiveTab] = useState<TabFilter>("PENDING");
  const [loading, setLoading] = useState(true);

  // Action modal state
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [actionType, setActionType] = useState<
    "APPROVED" | "REJECTED" | "RETURNED" | null
  >(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchTasks = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
          status: activeTab,
        });
        const res = await fetch(`/api/workflows/tasks?${params}`);
        if (res.ok) {
          const data = await res.json();
          setTasks(data.tasks);
          setPagination(data.pagination);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [activeTab]
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  function openActionModal(
    task: WorkflowTask,
    action: "APPROVED" | "REJECTED" | "RETURNED"
  ) {
    setSelectedTask(task);
    setActionType(action);
    setComment("");
    setActionError(null);
  }

  async function handleAction(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTask || !actionType) return;

    setSubmitting(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/workflows/tasks/${selectedTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType, comment }),
      });

      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || "Failed to process action");
        return;
      }

      setSelectedTask(null);
      setActionType(null);
      fetchTasks(pagination.page);
    } catch {
      setActionError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const tabs: { label: string; value: TabFilter; count?: number }[] = [
    { label: "Pending", value: "PENDING" },
    { label: "Completed", value: "COMPLETED" },
    { label: "All", value: "all" },
  ];

  function getStatusColor(status: string) {
    switch (status) {
      case "PENDING":
        return "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400";
      case "COMPLETED":
        return "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400";
      case "SKIPPED":
        return "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
    }
  }

  function getActionColor(action: string | null) {
    switch (action) {
      case "APPROVED":
        return "text-green-600 dark:text-green-400";
      case "REJECTED":
        return "text-red-600 dark:text-red-400";
      case "RETURNED":
        return "text-amber-600 dark:text-amber-400";
      default:
        return "text-gray-500";
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          My Tasks
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Workflow tasks assigned to you
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.value
                ? "border-karu-green text-karu-green"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tasks table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Reference #
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Subject
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Step
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Assigned
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                  Due Date
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    <svg
                      className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z"
                      />
                    </svg>
                    No tasks found
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr
                    key={task.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-karu-green font-medium">
                        {task.instance.referenceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {task.instance.subject}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {task.instance.template.name}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 hidden md:table-cell">
                      {task.stepName}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                      {new Date(task.assignedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-xs hidden lg:table-cell">
                      {task.dueAt ? (
                        <span
                          className={
                            new Date(task.dueAt) < new Date()
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : "text-gray-500 dark:text-gray-400"
                          }
                        >
                          {new Date(task.dueAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getStatusColor(
                          task.status
                        )}`}
                      >
                        {task.status}
                      </span>
                      {task.action && (
                        <span
                          className={`block text-xs mt-0.5 ${getActionColor(
                            task.action
                          )}`}
                        >
                          {task.action}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {task.status === "PENDING" ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openActionModal(task, "APPROVED")}
                            className="px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => openActionModal(task, "REJECTED")}
                            className="px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => openActionModal(task, "RETURNED")}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                          >
                            Return
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {task.completedAt
                            ? new Date(task.completedAt).toLocaleDateString(
                                "en-GB",
                                {
                                  day: "2-digit",
                                  month: "short",
                                }
                              )
                            : "-"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(
                pagination.page * pagination.limit,
                pagination.total
              )}{" "}
              of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => fetchTasks(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => fetchTasks(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action modal */}
      {selectedTask && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => {
              setSelectedTask(null);
              setActionType(null);
            }}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md animate-scale-in">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {actionType === "APPROVED" && "Approve Task"}
                {actionType === "REJECTED" && "Reject Task"}
                {actionType === "RETURNED" && "Return for Revision"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {selectedTask.instance.subject} &mdash;{" "}
                {selectedTask.stepName}
              </p>
            </div>

            <form onSubmit={handleAction} className="p-6 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {actionError}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Comment <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                  rows={4}
                  placeholder={
                    actionType === "APPROVED"
                      ? "Approved. Looks good."
                      : actionType === "REJECTED"
                        ? "Reason for rejection..."
                        : "What needs to be revised..."
                  }
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTask(null);
                    setActionType(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !comment.trim()}
                  className={`px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 ${
                    actionType === "APPROVED"
                      ? "bg-green-600 hover:bg-green-700"
                      : actionType === "REJECTED"
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {submitting && (
                    <svg
                      className="animate-spin h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {actionType === "APPROVED" && "Approve"}
                  {actionType === "REJECTED" && "Reject"}
                  {actionType === "RETURNED" && "Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
