"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

/* ---------- types ---------- */

interface MemoUser {
  id: string;
  name: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
}

interface MemoTask {
  id: string;
  stepName: string;
  stepIndex: number;
  status: string;
  action: string | null;
  comment: string | null;
  assignee: MemoUser;
  assignedAt: string;
  completedAt: string | null;
}

interface MemoEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  data: Record<string, unknown>;
  occurredAt: string;
}

interface MemoDetail {
  id: string;
  referenceNumber: string;
  workflowReference: string;
  subject: string;
  body: string;
  status: string;
  workflowStatus: string;
  from: { id: string; name: string; department: string; jobTitle: string };
  to: { id: string; name: string; department: string; jobTitle: string };
  startedAt: string;
  completedAt: string | null;
  tasks: MemoTask[];
  events: MemoEvent[];
  document: {
    id: string;
    referenceNumber: string;
    title: string;
    status: string;
    files?: { id: string; fileName: string; mimeType: string }[];
  } | null;
  canAct: boolean;
  currentAction: {
    taskId: string;
    stepName: string;
    type: string;
  } | null;
  initiatedById: string;
  isInitiator: boolean;
}

/* ---------- constants ---------- */

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_RECOMMENDATION:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL:
    "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  APPROVED:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  RETURNED:
    "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_RECOMMENDATION: "Pending Recommendation",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for Revision",
};

/* ---------- component ---------- */

export default function MemoDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const memoId = params.id as string;

  const [memo, setMemo] = useState<MemoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action modal state
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<string>("");
  const [actionComment, setActionComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchMemo = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memos/${memoId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to fetch memo");
      }
      const data = await res.json();
      setMemo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [memoId]);

  useEffect(() => {
    fetchMemo();
  }, [fetchMemo]);

  function openActionModal(type: string) {
    setActionType(type);
    setActionComment("");
    setShowActionModal(true);
  }

  async function handleAction() {
    if (!memo?.currentAction) return;
    if ((actionType === "REJECT" || actionType === "RETURN") && !actionComment.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/memos/${memoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionType,
          comment: actionComment.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to process action");
      }

      setShowActionModal(false);
      fetchMemo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-96 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
        <div className="h-48 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
      </div>
    );
  }

  if (error && !memo) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-6 py-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <Link
            href="/memos"
            className="text-sm text-karu-green hover:underline mt-2 inline-block"
          >
            Back to Memos
          </Link>
        </div>
      </div>
    );
  }

  if (!memo) return null;

  // Separate recommender and approver tasks
  const selfReviewTasks = memo.tasks.filter((t) =>
    t.stepName.startsWith("Self-Review")
  );
  const recommenderTasks = memo.tasks.filter((t) =>
    t.stepName.startsWith("Recommendation")
  );
  const approverTasks = memo.tasks.filter(
    (t) => t.stepName === "Final Approval"
  );

  // Get latest recommender and approver tasks (for revisions, there may be multiples)
  const latestSelfReview = selfReviewTasks[selfReviewTasks.length - 1];
  const latestRecommenders = recommenderTasks.slice(-approverTasks.length > 0 ? recommenderTasks.length : 0);
  const latestApprover = approverTasks[approverTasks.length - 1];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb and status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
            <Link
              href="/memos"
              className="hover:text-karu-green transition-colors"
            >
              Memos
            </Link>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span className="font-mono text-gray-700 dark:text-gray-300">
              {memo.referenceNumber}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {memo.subject}
          </h1>
        </div>
        <span
          className={`inline-flex items-center self-start px-3 py-1 rounded-full text-sm font-medium ${
            STATUS_STYLES[memo.status] ?? STATUS_STYLES.DRAFT
          }`}
        >
          {STATUS_LABELS[memo.status] ?? memo.status}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Action buttons - shown when it's the user's turn */}
      {memo.canAct && memo.currentAction && (
        <div className="bg-karu-green/5 dark:bg-karu-green/10 border border-karu-green/20 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
            This memo requires your{" "}
            {memo.currentAction.type === "APPROVE"
              ? "approval"
              : "recommendation"}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                openActionModal(
                  memo.currentAction!.type === "APPROVE"
                    ? "APPROVE"
                    : "RECOMMEND"
                )
              }
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              {memo.currentAction.type === "APPROVE"
                ? "Approve"
                : "Recommend"}
            </button>
            <button
              onClick={() => openActionModal("RETURN")}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 font-medium text-sm transition-colors hover:bg-orange-50 dark:hover:bg-orange-950/30"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
              Return for Revision
            </button>
            <button
              onClick={() => openActionModal("REJECT")}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 font-medium text-sm transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Formatted Memo */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up">
        <div className="p-6 sm:p-8">
          <div className="max-w-2xl mx-auto border-2 border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-950">
            {/* Header bar */}
            <div className="bg-[#02773b] px-6 py-4 text-center">
              <h3 className="text-white text-lg font-bold tracking-wide">
                KARATINA UNIVERSITY
              </h3>
              <p className="text-white/80 text-sm font-medium tracking-widest mt-0.5">
                INTERNAL MEMORANDUM
              </p>
            </div>

            {/* Memo content */}
            <div className="px-6 py-5 space-y-4">
              {/* Reference and Date */}
              <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-sm">
                <p>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    REF:{" "}
                  </span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">
                    {memo.referenceNumber}
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    DATE:{" "}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {formatDate(memo.startedAt)}
                  </span>
                </p>
              </div>

              <hr className="border-gray-300 dark:border-gray-600" />

              {/* To / From / Subject */}
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                    TO:
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {memo.to.name}
                    {memo.to.jobTitle && `, ${memo.to.jobTitle}`}
                    {memo.to.department && ` - ${memo.to.department}`}
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                    FROM:
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {memo.from.name}
                    {memo.from.jobTitle && `, ${memo.from.jobTitle}`}
                    {memo.from.department && ` - ${memo.from.department}`}
                  </span>
                </p>
                <p>
                  <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                    SUBJECT:
                  </span>
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    {memo.subject}
                  </span>
                </p>
              </div>

              <hr className="border-gray-300 dark:border-gray-600" />

              {/* Body */}
              <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed min-h-[80px]">
                {memo.body}
              </div>

              <hr className="border-gray-300 dark:border-gray-600" />

              {/* Recommenders */}
              {latestRecommenders.length > 0 && (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
                    RECOMMENDED BY:
                  </p>
                  {latestRecommenders.map((task, index) => {
                    const isSigned = task.action === "APPROVED";
                    return (
                      <div
                        key={task.id}
                        className="flex items-end gap-4 text-sm"
                      >
                        <span className="text-gray-500 dark:text-gray-400 font-medium w-6">
                          {index + 1}.
                        </span>
                        <div className="flex-1">
                          {isSigned ? (
                            <div className="pb-1 mb-1">
                              <p className="text-karu-green font-medium italic">
                                Recommended
                              </p>
                              {task.comment && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  &quot;{task.comment}&quot;
                                </p>
                              )}
                            </div>
                          ) : task.action === "RETURNED" ? (
                            <div className="pb-1 mb-1">
                              <p className="text-orange-600 dark:text-orange-400 font-medium italic">
                                Returned
                              </p>
                            </div>
                          ) : task.action === "REJECTED" ? (
                            <div className="pb-1 mb-1">
                              <p className="text-red-600 dark:text-red-400 font-medium italic">
                                Rejected
                              </p>
                            </div>
                          ) : (
                            <div className="border-b border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-1 min-w-[200px]" />
                          )}
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {task.assignee.displayName || task.assignee.name}
                            {task.assignee.jobTitle && `, ${task.assignee.jobTitle}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {task.completedAt
                              ? `Date: ${formatDate(task.completedAt)}`
                              : "Date: ___________"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Approver */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
                  APPROVED BY:
                </p>
                {latestApprover && (
                  <div className="flex items-end gap-4 text-sm">
                    <div className="flex-1">
                      {latestApprover.action === "APPROVED" ? (
                        <div className="pb-1 mb-1">
                          <p className="text-karu-green font-medium italic">
                            Approved
                          </p>
                          {latestApprover.comment && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              &quot;{latestApprover.comment}&quot;
                            </p>
                          )}
                        </div>
                      ) : latestApprover.action === "RETURNED" ? (
                        <div className="pb-1 mb-1">
                          <p className="text-orange-600 dark:text-orange-400 font-medium italic">
                            Returned for revision
                          </p>
                        </div>
                      ) : latestApprover.action === "REJECTED" ? (
                        <div className="pb-1 mb-1">
                          <p className="text-red-600 dark:text-red-400 font-medium italic">
                            Rejected
                          </p>
                        </div>
                      ) : (
                        <div className="border-b border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-1 min-w-[200px]" />
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {latestApprover.assignee.displayName || latestApprover.assignee.name}
                        {latestApprover.assignee.jobTitle && `, ${latestApprover.assignee.jobTitle}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {latestApprover.completedAt
                          ? `Date: ${formatDate(latestApprover.completedAt)}`
                          : "Date: ___________"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer bar */}
            <div className="bg-[#02773b] h-2" />
          </div>
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 animate-slide-up delay-100">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Workflow Progress
        </h2>

        <div className="space-y-0">
          {memo.tasks
            .filter(
              (t, i, arr) =>
                // Show only the latest version of each step
                !arr.some(
                  (other) =>
                    other.stepIndex === t.stepIndex &&
                    other.assignedAt > t.assignedAt &&
                    other.id !== t.id
                ) || t.status !== "SKIPPED"
            )
            .sort((a, b) => a.stepIndex - b.stepIndex || new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())
            .reduce<MemoTask[]>((unique, task) => {
              // Keep only the latest task per stepIndex
              const existingIdx = unique.findIndex(
                (u) => u.stepIndex === task.stepIndex
              );
              if (existingIdx >= 0) {
                if (
                  new Date(task.assignedAt).getTime() >
                  new Date(unique[existingIdx].assignedAt).getTime()
                ) {
                  unique[existingIdx] = task;
                }
              } else {
                unique.push(task);
              }
              return unique;
            }, [])
            .map((task, index, arr) => {
              const isCompleted = task.status === "COMPLETED";
              const isPending = task.status === "PENDING";
              const isSkipped = task.status === "SKIPPED";
              const isLast = index === arr.length - 1;

              let statusColor = "bg-gray-200 dark:bg-gray-700";
              let iconColor = "text-gray-400";
              if (isCompleted && task.action === "APPROVED") {
                statusColor = "bg-karu-green";
                iconColor = "text-white";
              } else if (isCompleted && task.action === "REJECTED") {
                statusColor = "bg-red-500";
                iconColor = "text-white";
              } else if (isCompleted && task.action === "RETURNED") {
                statusColor = "bg-orange-500";
                iconColor = "text-white";
              } else if (isPending) {
                statusColor = "bg-blue-500";
                iconColor = "text-white";
              }

              return (
                <div key={task.id} className="flex gap-3">
                  {/* Timeline line */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${statusColor}`}
                    >
                      {isCompleted && task.action === "APPROVED" ? (
                        <svg className={`w-4 h-4 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : isCompleted && task.action === "REJECTED" ? (
                        <svg className={`w-4 h-4 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      ) : isCompleted && task.action === "RETURNED" ? (
                        <svg className={`w-4 h-4 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                        </svg>
                      ) : isPending ? (
                        <div className={`w-3 h-3 rounded-full bg-white animate-pulse`} />
                      ) : (
                        <div className={`w-2 h-2 rounded-full bg-gray-400`} />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className={`w-0.5 flex-1 min-h-[24px] ${
                          isCompleted && task.action === "APPROVED"
                            ? "bg-karu-green/30"
                            : "bg-gray-200 dark:bg-gray-700"
                        }`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className={`pb-4 ${isSkipped ? "opacity-50" : ""}`}>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {task.stepName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {task.assignee.displayName || task.assignee.name}
                      {task.assignee.jobTitle && ` - ${task.assignee.jobTitle}`}
                    </p>
                    {task.completedAt && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {formatDateTime(task.completedAt)}
                      </p>
                    )}
                    {task.comment && (
                      <div className="mt-1.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                        &quot;{task.comment}&quot;
                      </div>
                    )}
                    {isPending && (
                      <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">
                        Awaiting action
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 animate-slide-up delay-200">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Activity Timeline
        </h2>

        {memo.events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No activity yet.
          </p>
        ) : (
          <div className="space-y-3">
            {memo.events.map((event) => {
              const data = event.data as Record<string, unknown>;
              let description = "";
              let iconBg = "bg-gray-200 dark:bg-gray-700";

              switch (event.eventType) {
                case "MEMO_CREATED":
                  description = `Memo created and sent for ${(data.recommenderCount as number) > 0 ? "recommendation" : "approval"}`;
                  iconBg = "bg-karu-green";
                  break;
                case "MEMO_RECOMMEND":
                  description = `${data.actorName || "User"} recommended at step "${data.stepName}"`;
                  iconBg = "bg-emerald-500";
                  break;
                case "MEMO_APPROVE":
                  description = `${data.actorName || "User"} approved the memo`;
                  iconBg = "bg-karu-green";
                  break;
                case "MEMO_REJECT":
                  description = `${data.actorName || "User"} rejected at step "${data.stepName}"`;
                  iconBg = "bg-red-500";
                  break;
                case "MEMO_RETURN":
                  description = `${data.actorName || "User"} returned for revision from "${data.stepName}"`;
                  iconBg = "bg-orange-500";
                  break;
                default:
                  description = event.eventType.replace(/_/g, " ");
              }

              return (
                <div key={event.id} className="flex items-start gap-3">
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${iconBg}`}
                  />
                  <div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {description}
                    </p>
                    {typeof data.comment === "string" && data.comment && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Comment: &quot;{data.comment}&quot;
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {formatDateTime(event.occurredAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Back to memos */}
      <div className="flex justify-start">
        <button
          onClick={() => router.push("/memos")}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back to Memos
        </button>
      </div>

      {/* Action Modal */}
      {showActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowActionModal(false)}
          />

          {/* Modal */}
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-md animate-scale-in">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {actionType === "RECOMMEND"
                  ? "Recommend Memo"
                  : actionType === "APPROVE"
                  ? "Approve Memo"
                  : actionType === "RETURN"
                  ? "Return for Revision"
                  : "Reject Memo"}
              </h3>
            </div>

            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {actionType === "RECOMMEND"
                  ? "Are you sure you want to recommend this memo? It will be forwarded to the next person in the approval chain."
                  : actionType === "APPROVE"
                  ? "Are you sure you want to approve this memo? It will be archived as an official record."
                  : actionType === "RETURN"
                  ? "Return this memo to the initiator for revision. Please provide a reason."
                  : "Are you sure you want to reject this memo? This action is final. Please provide a reason."}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Comment{" "}
                  {actionType === "REJECT" || actionType === "RETURN"
                    ? "(required)"
                    : "(optional)"}
                </label>
                <textarea
                  value={actionComment}
                  onChange={(e) => setActionComment(e.target.value)}
                  rows={3}
                  placeholder={
                    actionType === "RETURN"
                      ? "Explain what needs to be revised..."
                      : actionType === "REJECT"
                      ? "Explain the reason for rejection..."
                      : "Add a comment..."
                  }
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setShowActionModal(false)}
                className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={
                  isSubmitting ||
                  ((actionType === "REJECT" || actionType === "RETURN") &&
                    !actionComment.trim())
                }
                className={`h-9 px-4 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  actionType === "REJECT"
                    ? "bg-red-600 hover:bg-red-700"
                    : actionType === "RETURN"
                    ? "bg-orange-600 hover:bg-orange-700"
                    : "bg-karu-green hover:bg-karu-green-dark"
                }`}
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </div>
                ) : actionType === "RECOMMEND" ? (
                  "Confirm Recommendation"
                ) : actionType === "APPROVE" ? (
                  "Confirm Approval"
                ) : actionType === "RETURN" ? (
                  "Return for Revision"
                ) : (
                  "Confirm Rejection"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
