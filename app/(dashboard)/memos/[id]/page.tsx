"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import MemoDocument from "@/components/memo/memo-document";

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
  departmentOffice: string;
  designation: string;
  cc: string[];
}

interface DepartmentInfo {
  name: string;
  userCount: number;
}

interface UserOption {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
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

  const printRef = useRef<HTMLDivElement>(null);

  // Action modal state
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<string>("");
  const [actionComment, setActionComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Circulate modal state
  const [showCirculateModal, setShowCirculateModal] = useState(false);
  const [circulateMessage, setCirculateMessage] = useState("");
  const [circulateDepts, setCirculateDepts] = useState<string[]>([]);
  const [circulateUsers, setCirculateUsers] = useState<UserOption[]>([]);
  const [isCirculating, setIsCirculating] = useState(false);
  const [circulateSuccess, setCirculateSuccess] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentInfo[]>([]);
  const [deptQuery, setDeptQuery] = useState("");
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserOption[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const userSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleDownloadPdf() {
    window.print();
  }

  function openCirculateModal() {
    setCirculateMessage("");
    setCirculateDepts([]);
    setCirculateUsers([]);
    setCirculateSuccess(null);
    setShowCirculateModal(true);
    // Fetch departments if not already loaded
    if (departments.length === 0) {
      fetch("/api/users/search?departments=true")
        .then((r) => r.json())
        .then((data) => setDepartments(data.departments ?? []))
        .catch(() => {});
    }
  }

  function handleUserSearch(value: string) {
    setUserSearchQuery(value);
    if (userSearchDebounce.current) clearTimeout(userSearchDebounce.current);
    if (value.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    userSearchDebounce.current = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const excludeIds = circulateUsers.map((u) => u.id).join(",");
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(value.trim())}&limit=10${excludeIds ? `&exclude=${excludeIds}` : ""}`
        );
        if (res.ok) {
          const data = await res.json();
          setUserSearchResults(data.users ?? []);
        }
      } catch {
        // ignore
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);
  }

  async function handleCirculate() {
    if (circulateDepts.length === 0 && circulateUsers.length === 0) return;
    setIsCirculating(true);
    try {
      const res = await fetch(`/api/memos/${memoId}/circulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: circulateUsers.map((u) => u.id),
          departments: circulateDepts,
          message: circulateMessage.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to circulate");
      }
      const data = await res.json();
      setCirculateSuccess(`Memo circulated to ${data.recipientCount} recipient${data.recipientCount !== 1 ? "s" : ""}.`);
      fetchMemo(); // refresh events
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to circulate");
    } finally {
      setIsCirculating(false);
    }
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-96 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
        <div className="h-48 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
      </div>
    );
  }

  if (error && !memo) {
    return (
      <div className="p-4 sm:p-6">
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

  // Build print-ready props
  const memoPrintProps = {
    universityName: "KARATINA UNIVERSITY",
    departmentOffice: memo.departmentOffice || "OFFICE OF THE REGISTRAR",
    designation: memo.designation || "",
    phone: "+254 0716135171/0723683150",
    poBox: "P.O Box 1957-10101,KARATINA",
    from: memo.from.name,
    date: formatDate(memo.startedAt),
    to: [memo.to.name, memo.to.jobTitle].filter(Boolean).join(", "),
    refNumber: memo.referenceNumber,
    subject: memo.subject,
    bodyHtml: memo.body,
    senderName: memo.from.name,
    senderTitle: memo.designation || memo.from.jobTitle || "",
    copyTo: [] as string[], // populated from CC if needed
    recommenders: latestRecommenders.map((t) => ({
      name: t.assignee.displayName || t.assignee.name,
      title: t.assignee.jobTitle ?? "",
      signed: t.action === "APPROVED",
      date: t.completedAt ? formatDate(t.completedAt) : undefined,
    })),
    approver: latestApprover
      ? {
          name: latestApprover.assignee.displayName || latestApprover.assignee.name,
          title: latestApprover.assignee.jobTitle ?? "",
          signed: latestApprover.action === "APPROVED",
          date: latestApprover.completedAt
            ? formatDate(latestApprover.completedAt)
            : undefined,
        }
      : undefined,
    isDraft: memo.status !== "APPROVED",
  };

  const isApproved = memo.status === "APPROVED";

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">
      {/* Hidden print document */}
      <div className="hidden print-only">
        <MemoDocument ref={printRef} {...memoPrintProps} />
      </div>

      {/* Breadcrumb and status */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
        <div className="flex items-center gap-2 self-start">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              STATUS_STYLES[memo.status] ?? STATUS_STYLES.DRAFT
            }`}
          >
            {STATUS_LABELS[memo.status] ?? memo.status}
          </span>
          <button
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            title="Download PDF"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </button>
          {isApproved && (
            <button
              onClick={openCirculateModal}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#02773b] text-white text-sm font-medium transition-colors hover:bg-[#014d28]"
              title="Circulate memo"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
              </svg>
              Circulate
            </button>
          )}
        </div>
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

      {/* Main content: Memo (3/4) + Sidebar cards (1/4) */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">

      {/* Memo Document — spans 3 columns */}
      <div className="xl:col-span-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up">
        <div className="p-4 sm:p-6">
          <div className="border-2 border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-950">
            {/* Header bar */}
            <div className="bg-[#02773b] px-6 py-3 flex items-center justify-center gap-3">
              <img
                src="/karu-crest.png"
                alt="KarU Crest"
                className="h-12 w-12 object-contain"
              />
              <div className="text-center">
                <h3 className="text-white text-lg font-bold tracking-wide">
                  KARATINA UNIVERSITY
                </h3>
                <p className="text-white/80 text-sm font-medium tracking-widest mt-0.5">
                  Internal Memo
                </p>
              </div>
            </div>

            {/* Memo content */}
            <div className="px-6 py-4 space-y-3">
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
              <div
                className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed min-h-[80px] prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: memo.body }}
              />

              {/* Initiator / Sender */}
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
                  INITIATED BY:
                </p>
                <div className="border-b border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-1 min-w-[200px]" />
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {memo.from.name}
                  {memo.from.jobTitle && `, ${memo.from.jobTitle}`}
                </p>
                {memo.from.department && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {memo.from.department}
                  </p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Date: {formatDate(memo.startedAt)}
                </p>
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

      {/* Sidebar — spans 1 column */}
      <div className="xl:col-span-1 space-y-5">
        {/* Workflow Progress */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-100">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-[#02773b]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
              Workflow Progress
            </h2>
          </div>

          <div className="p-5 space-y-0">
            {memo.tasks
              .filter(
                (t, i, arr) =>
                  !arr.some(
                    (other) =>
                      other.stepIndex === t.stepIndex &&
                      other.assignedAt > t.assignedAt &&
                      other.id !== t.id
                  ) || t.status !== "SKIPPED"
              )
              .sort((a, b) => a.stepIndex - b.stepIndex || new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())
              .reduce<MemoTask[]>((unique, task) => {
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
                  statusColor = "bg-[#02773b]";
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
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${statusColor}`}
                      >
                        {isCompleted && task.action === "APPROVED" ? (
                          <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        ) : isCompleted && task.action === "REJECTED" ? (
                          <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        ) : isCompleted && task.action === "RETURNED" ? (
                          <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                          </svg>
                        ) : isPending ? (
                          <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-gray-400" />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className={`w-0.5 flex-1 min-h-[20px] ${
                            isCompleted && task.action === "APPROVED"
                              ? "bg-[#02773b]/30"
                              : "bg-gray-200 dark:bg-gray-700"
                          }`}
                        />
                      )}
                    </div>
                    <div className={`pb-3 ${isSkipped ? "opacity-50" : ""}`}>
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
                        <div className="mt-1 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-200">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-[#dd9f42]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Activity Timeline
            </h2>
          </div>

          <div className="p-5">
            {memo.events.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No activity yet.
              </p>
            ) : (
              <div className="space-y-3">
                {memo.events.map((event) => {
                  const data = event.data as Record<string, unknown>;
                  let description = "";
                  let iconBg = "bg-gray-300 dark:bg-gray-600";

                  switch (event.eventType) {
                    case "MEMO_CREATED":
                      description = `Memo created and sent for ${(data.recommenderCount as number) > 0 ? "recommendation" : "approval"}`;
                      iconBg = "bg-[#02773b]";
                      break;
                    case "MEMO_RECOMMEND":
                      description = `${data.actorName || "User"} recommended at step "${data.stepName}"`;
                      iconBg = "bg-emerald-500";
                      break;
                    case "MEMO_APPROVE":
                      description = `${data.actorName || "User"} approved the memo`;
                      iconBg = "bg-[#02773b]";
                      break;
                    case "MEMO_REJECT":
                      description = `${data.actorName || "User"} rejected at step "${data.stepName}"`;
                      iconBg = "bg-red-500";
                      break;
                    case "MEMO_RETURN":
                      description = `${data.actorName || "User"} returned for revision from "${data.stepName}"`;
                      iconBg = "bg-orange-500";
                      break;
                    case "MEMO_CIRCULATED":
                      description = `${data.actorName || "User"} circulated to ${data.recipientCount} recipient${(data.recipientCount as number) !== 1 ? "s" : ""}`;
                      iconBg = "bg-blue-500";
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
                            &quot;{data.comment}&quot;
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
        </div>
      </div>{/* end sidebar */}
      </div>{/* end main grid */}

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

      {/* Circulate Modal */}
      {showCirculateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isCirculating && setShowCirculateModal(false)}
          />

          <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-lg animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                </svg>
                Circulate Memo
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Share this approved memo with users or entire departments.
              </p>
            </div>

            {circulateSuccess ? (
              <div className="px-6 py-8 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-[#02773b]/10 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {circulateSuccess}
                </p>
                <button
                  onClick={() => setShowCirculateModal(false)}
                  className="mt-4 h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="px-6 py-4 space-y-4">
                  {/* Departments */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Departments
                    </label>
                    {circulateDepts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {circulateDepts.map((dept) => (
                          <span
                            key={dept}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400"
                          >
                            {dept}
                            <button
                              type="button"
                              onClick={() =>
                                setCirculateDepts(circulateDepts.filter((d) => d !== dept))
                              }
                              className="opacity-60 hover:opacity-100"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div ref={deptDropdownRef} className="relative">
                      <input
                        type="text"
                        value={deptQuery}
                        onChange={(e) => {
                          setDeptQuery(e.target.value);
                          setIsDeptDropdownOpen(true);
                        }}
                        onFocus={() => setIsDeptDropdownOpen(true)}
                        placeholder="Type to search departments..."
                        className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                      />
                      {isDeptDropdownOpen && (
                        <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                          {departments
                            .filter(
                              (d) =>
                                !circulateDepts.includes(d.name) &&
                                (!deptQuery ||
                                  d.name.toLowerCase().includes(deptQuery.toLowerCase()))
                            )
                            .map((dept) => (
                              <button
                                key={dept.name}
                                type="button"
                                onClick={() => {
                                  setCirculateDepts([...circulateDepts, dept.name]);
                                  setDeptQuery("");
                                  setIsDeptDropdownOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                              >
                                <span className="text-gray-900 dark:text-gray-100">
                                  {dept.name}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {dept.userCount} users
                                </span>
                              </button>
                            ))}
                          {departments.filter(
                            (d) =>
                              !circulateDepts.includes(d.name) &&
                              (!deptQuery ||
                                d.name.toLowerCase().includes(deptQuery.toLowerCase()))
                          ).length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                              No departments found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Users */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Individual Users
                    </label>
                    {circulateUsers.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {circulateUsers.map((user) => (
                          <span
                            key={user.id}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          >
                            {user.displayName}
                            <button
                              type="button"
                              onClick={() =>
                                setCirculateUsers(circulateUsers.filter((u) => u.id !== user.id))
                              }
                              className="opacity-60 hover:opacity-100"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={userSearchQuery}
                        onChange={(e) => handleUserSearch(e.target.value)}
                        placeholder="Search by name or email..."
                        className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                      />
                      {isSearchingUsers && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-4 h-4 border-2 border-[#02773b] border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {userSearchResults.length > 0 && (
                        <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                          {userSearchResults.map((user) => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => {
                                setCirculateUsers([...circulateUsers, user]);
                                setUserSearchQuery("");
                                setUserSearchResults([]);
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              <p className="font-medium text-gray-900 dark:text-gray-100">
                                {user.displayName}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {[user.jobTitle, user.department].filter(Boolean).join(" - ")}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Optional message */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Message <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={circulateMessage}
                      onChange={(e) => setCirculateMessage(e.target.value)}
                      rows={2}
                      placeholder="Add a note to recipients..."
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20 resize-none"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                  <button
                    onClick={() => setShowCirculateModal(false)}
                    className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCirculate}
                    disabled={
                      isCirculating ||
                      (circulateDepts.length === 0 && circulateUsers.length === 0)
                    }
                    className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCirculating ? (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Sending...
                      </div>
                    ) : (
                      `Circulate to ${circulateDepts.length + circulateUsers.length} recipient${circulateDepts.length + circulateUsers.length !== 1 ? "s" : ""}`
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
