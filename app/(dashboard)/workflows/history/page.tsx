"use client";

import { useState, useEffect, useCallback } from "react";

interface WorkflowTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  assignee: { id: string; name: string; displayName: string };
  assignedAt: string;
  completedAt: string | null;
}

interface WorkflowInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  currentStepIndex: number;
  startedAt: string;
  completedAt: string | null;
  template: { id: string; name: string };
  document: {
    id: string;
    title: string;
    referenceNumber: string;
  } | null;
  tasks: WorkflowTask[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function WorkflowHistoryPage() {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchInstances = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "20",
        });
        if (statusFilter) params.set("status", statusFilter);

        const res = await fetch(`/api/workflows?${params}`);
        if (res.ok) {
          const data = await res.json();
          setInstances(data.instances);
          setPagination(data.pagination);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [statusFilter]
  );

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      PENDING:
        "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
      IN_PROGRESS:
        "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
      COMPLETED:
        "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400",
      REJECTED:
        "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
      CANCELLED:
        "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
          styles[status] || styles.PENDING
        }`}
      >
        {status.replace("_", " ")}
      </span>
    );
  }

  function getTaskActionIcon(action: string | null) {
    switch (action) {
      case "APPROVED":
        return (
          <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-950/50 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
          </div>
        );
      case "REJECTED":
        return (
          <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </div>
        );
      case "RETURNED":
        return (
          <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
              />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
        );
    }
  }

  const statuses = [
    { label: "All", value: "" },
    { label: "Pending", value: "PENDING" },
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Rejected", value: "REJECTED" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Workflow History
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          All workflow instances you initiated or participated in
        </p>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {statuses.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s.value
                ? "bg-karu-green text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-8" />
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Reference #
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Template
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Subject
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Initiated
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  Completed
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
              ) : instances.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    No workflow instances found
                  </td>
                </tr>
              ) : (
                instances.map((inst) => (
                  <>
                    <tr
                      key={inst.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                      onClick={() =>
                        setExpandedId(
                          expandedId === inst.id ? null : inst.id
                        )
                      }
                    >
                      <td className="px-4 py-3">
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${
                            expandedId === inst.id ? "rotate-90" : ""
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m8.25 4.5 7.5 7.5-7.5 7.5"
                          />
                        </svg>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-karu-green font-medium">
                          {inst.referenceNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {inst.template.name}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        {inst.subject}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(inst.status)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden md:table-cell">
                        {new Date(inst.startedAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden md:table-cell">
                        {inst.completedAt
                          ? new Date(inst.completedAt).toLocaleDateString(
                              "en-GB",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              }
                            )
                          : "-"}
                      </td>
                    </tr>
                    {/* Timeline expansion */}
                    {expandedId === inst.id && (
                      <tr key={`${inst.id}-timeline`}>
                        <td
                          colSpan={7}
                          className="px-4 py-4 bg-gray-50 dark:bg-gray-800/30"
                        >
                          <div className="ml-8">
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                              Workflow Timeline
                            </h4>
                            <div className="space-y-3">
                              {inst.tasks.map((task, idx) => (
                                <div
                                  key={task.id}
                                  className="flex items-start gap-3"
                                >
                                  {/* Timeline connector */}
                                  <div className="flex flex-col items-center">
                                    {getTaskActionIcon(task.action)}
                                    {idx < inst.tasks.length - 1 && (
                                      <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mt-1" />
                                    )}
                                  </div>
                                  {/* Task details */}
                                  <div className="flex-1 min-w-0 pb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {task.stepName}
                                      </span>
                                      <span
                                        className={`text-xs ${
                                          task.status === "COMPLETED"
                                            ? "text-green-600 dark:text-green-400"
                                            : task.status === "PENDING"
                                              ? "text-amber-600 dark:text-amber-400"
                                              : "text-gray-400"
                                        }`}
                                      >
                                        {task.status}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                      Assigned to{" "}
                                      <span className="font-medium">
                                        {task.assignee.displayName}
                                      </span>
                                      {task.completedAt && (
                                        <>
                                          {" "}
                                          &middot; Completed{" "}
                                          {new Date(
                                            task.completedAt
                                          ).toLocaleDateString("en-GB", {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                          })}
                                        </>
                                      )}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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
                onClick={() => fetchInstances(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => fetchInstances(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
