"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import MemoDocument from "@/components/memo/memo-document";
import { MultiUserInput } from "@/components/shared/multi-user-input";

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
    files?: { id: string; fileName: string; mimeType: string; sizeBytes?: number; storagePath?: string }[];
  } | null;
  canAct: boolean;
  currentAction: {
    taskId: string;
    stepName: string;
    type: string;
  } | null;
  initiatedById: string;
  isInitiator: boolean;
  originalInitiatedBy?: {
    id: string;
    name: string;
    displayName: string | null;
    department: string | null;
    jobTitle: string | null;
  } | null;
  departmentOffice: string;
  designation: string;
  cc: string[];
  senderIsSuperior: boolean;
  memoType: string;
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

  const currentUserId = session?.user?.id;

  // Approver actions pause while a clarification they requested is still unanswered.
  const outstandingClarifications = useMemo(() => {
    if (!memo || !currentUserId) return [];
    const provided = new Set(
      memo.events
        .filter((e) => e.eventType === "MEMO_CLARIFICATION_PROVIDED")
        .map((e) => String((e.data as Record<string, unknown>)?.requestEventId ?? ""))
        .filter(Boolean)
    );
    return memo.events.filter(
      (e) =>
        e.eventType === "MEMO_CLARIFICATION_REQUESTED" &&
        e.actorId === currentUserId &&
        !provided.has(e.id)
    );
  }, [memo, currentUserId]);

  const isWaitingForClarification = outstandingClarifications.length > 0;

  // Clarification requests that target the current user (or their department)
  // and are still awaiting a response.
  const pendingMyClarificationRequests = useMemo(() => {
    if (!memo || !currentUserId) return [];
    const userDepartment = (session?.user as { department?: string | null } | undefined)?.department;
    const provided = new Set(
      memo.events
        .filter((e) => e.eventType === "MEMO_CLARIFICATION_PROVIDED")
        .map((e) => String((e.data as Record<string, unknown>)?.requestEventId ?? ""))
        .filter(Boolean)
    );
    return memo.events.filter((e) => {
      if (e.eventType !== "MEMO_CLARIFICATION_REQUESTED") return false;
      if (provided.has(e.id)) return false;
      const d = e.data as Record<string, unknown>;
      if (d.targetUserId === currentUserId) return true;
      if (userDepartment && d.targetDepartment === userDepartment) return true;
      return false;
    });
  }, [memo, currentUserId, session]);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewTemplateUrl, setPreviewTemplateUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ fileName: string; mimeType: string; storagePath: string } | null>(null);

  // Action modal state
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<string>("");
  const [actionComment, setActionComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionCcUsers, setActionCcUsers] = useState<UserOption[]>([]);
  const [actionCcDepts, setActionCcDepts] = useState<string[]>([]);
  const [actionCcAllDepts, setActionCcAllDepts] = useState(false);

  // Clarification modal state
  const [showClarifyModal, setShowClarifyModal] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyMode, setClarifyMode] = useState<"user" | "department">("user");
  const [clarifyTarget, setClarifyTarget] = useState<UserOption | null>(null);
  const [clarifyDepartment, setClarifyDepartment] = useState<string | null>(null);
  const [clarifyDeptQuery, setClarifyDeptQuery] = useState("");
  const [clarifyDeptDropdownOpen, setClarifyDeptDropdownOpen] = useState(false);
  const [clarifySearchQuery, setClarifySearchQuery] = useState("");
  const [clarifySearchResults, setClarifySearchResults] = useState<UserOption[]>([]);
  const [isSearchingClarify, setIsSearchingClarify] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);

  // Clarification response state
  const [showClarifyResponse, setShowClarifyResponse] = useState<string | null>(null); // event ID for modal
  const [clarifyResponseText, setClarifyResponseText] = useState("");
  const [clarifyResponseFiles, setClarifyResponseFiles] = useState<File[]>([]);
  const [isRespondingClarify, setIsRespondingClarify] = useState(false);

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
  const clarifyDeptRef = useRef<HTMLDivElement>(null);
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

  // Close clarify department dropdown on outside click (only while modal open)
  useEffect(() => {
    if (!showClarifyModal) return;
    function handleClick(e: MouseEvent) {
      if (clarifyDeptRef.current && !clarifyDeptRef.current.contains(e.target as Node)) {
        setClarifyDeptDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showClarifyModal]);

  // Fetch departments lazily when clarify modal opens or switches to department mode
  useEffect(() => {
    if (!showClarifyModal) return;
    if (clarifyMode !== "department") return;
    if (departments.length > 0) return;
    fetch("/api/users/search?departments=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.departments && setDepartments(data.departments))
      .catch(() => {});
  }, [showClarifyModal, clarifyMode, departments.length]);

  function openActionModal(type: string) {
    setActionType(type);
    setActionComment("");
    setActionCcUsers([]);
    setActionCcDepts([]);
    setActionCcAllDepts(false);
    setShowActionModal(true);
    // Prefetch departments if the user opts to CC all departments later
    if (type === "APPROVE" && departments.length === 0) {
      fetch("/api/users/search?departments=true")
        .then((r) => r.json())
        .then((data) => setDepartments(data.departments ?? []))
        .catch(() => {});
    }
  }

  async function handleAction() {
    if (!memo?.currentAction) return;
    if ((actionType === "REJECT" || actionType === "RETURN") && !actionComment.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // For APPROVE, collect display names from the user picker + department names.
      // When "CC All Departments" is toggled, add it as a single friendly label.
      const finalAdditionalCc = Array.from(
        new Set([
          ...actionCcUsers.map((u) => u.displayName || u.name),
          ...(actionCcAllDepts ? ["All Departments"] : actionCcDepts),
        ])
      );

      const res = await fetch(`/api/memos/${memoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionType,
          comment: actionComment.trim() || undefined,
          ...(actionType === "APPROVE" && finalAdditionalCc.length > 0
            ? { additionalCc: finalAdditionalCc }
            : {}),
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

  async function generatePdfBlobUrl(): Promise<string> {
    const el = printRef.current!;
    const wrapper = el.parentElement as HTMLElement;
    const prev = {
      position: wrapper.style.position, left: wrapper.style.left,
      top: wrapper.style.top, visibility: wrapper.style.visibility, display: wrapper.style.display,
    };
    wrapper.style.display = "block";
    wrapper.style.position = "absolute";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.visibility = "visible";

    const { toPng } = await import("html-to-image");
    const { PDFDocument } = await import("pdf-lib");
    const dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: true });
    Object.assign(wrapper.style, prev);

    const imgBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
    const pdfDoc = await PDFDocument.create();
    const img = await pdfDoc.embedPng(imgBytes);
    const pageW = 595.28;
    const pageH = 841.89;
    const imgAspect = img.height / img.width;
    const numPages = Math.ceil((pageW * imgAspect) / pageH);

    for (let i = 0; i < numPages; i++) {
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(img, {
        x: 0,
        y: pageH - pageW * imgAspect + i * pageH,
        width: pageW,
        height: pageW * imgAspect,
      });
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
    return URL.createObjectURL(blob);
  }

  async function handleDownloadPdf() {
    if (!printRef.current || isDownloading) return;
    setIsDownloading(true);
    try {
      const url = await generatePdfBlobUrl();
      const a = document.createElement("a");
      a.href = url;
      a.download = `${memo?.referenceNumber ?? "memo"}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      window.print();
    } finally {
      setIsDownloading(false);
    }
  }

  async function handlePreviewTemplate() {
    if (!printRef.current || isGeneratingPreview) return;
    setIsGeneratingPreview(true);
    try {
      const url = await generatePdfBlobUrl();
      setPreviewTemplateUrl(url);
    } catch {
      // ignore
    } finally {
      setIsGeneratingPreview(false);
    }
  }

  function closeTemplatePreview() {
    if (previewTemplateUrl) URL.revokeObjectURL(previewTemplateUrl);
    setPreviewTemplateUrl(null);
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

  const clarifyDebounce = useRef<NodeJS.Timeout | null>(null);

  function searchClarifyUsers(value: string) {
    setClarifySearchQuery(value);
    if (clarifyDebounce.current) clearTimeout(clarifyDebounce.current);
    if (!value.trim()) { setClarifySearchResults([]); return; }
    clarifyDebounce.current = setTimeout(async () => {
      setIsSearchingClarify(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(value.trim())}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setClarifySearchResults(data.users ?? []);
        }
      } catch { /* ignore */ }
      setIsSearchingClarify(false);
    }, 300);
  }

  async function handleSeekClarification() {
    const hasTarget = clarifyMode === "user" ? !!clarifyTarget : !!clarifyDepartment;
    if (!hasTarget || !clarifyQuestion.trim()) return;
    setIsClarifying(true);
    try {
      const res = await fetch(`/api/memos/${memoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SEEK_CLARIFICATION",
          comment: clarifyQuestion.trim(),
          ...(clarifyMode === "user"
            ? { clarifyUserId: clarifyTarget!.id }
            : { clarifyDepartment }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to seek clarification");
      }
      setShowClarifyModal(false);
      setClarifyQuestion("");
      setClarifyTarget(null);
      setClarifyDepartment(null);
      setClarifyMode("user");
      fetchMemo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seek clarification");
    } finally {
      setIsClarifying(false);
    }
  }

  async function handleRespondClarification(eventId: string) {
    if (!clarifyResponseText.trim()) return;
    setIsRespondingClarify(true);
    try {
      // Upload any attached files first (linked to the memo's document)
      const attachmentIds: string[] = [];
      const documentId = memo?.document?.id;
      if (clarifyResponseFiles.length > 0 && documentId) {
        for (const file of clarifyResponseFiles) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("documentId", documentId);
          const uploadRes = await fetch("/api/files", { method: "POST", body: fd });
          if (!uploadRes.ok) {
            const err = await uploadRes.json().catch(() => null);
            throw new Error(err?.error ?? "Failed to upload attachment");
          }
          const uploaded = await uploadRes.json();
          if (uploaded?.id) attachmentIds.push(uploaded.id);
        }
      }

      const res = await fetch(`/api/memos/${memoId}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: clarifyResponseText.trim(),
          requestEventId: eventId,
          attachmentIds,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to respond");
      }
      setShowClarifyResponse(null);
      setClarifyResponseText("");
      setClarifyResponseFiles([]);
      fetchMemo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond");
    } finally {
      setIsRespondingClarify(false);
    }
  }

  function openClarifyResponseModal(eventId: string) {
    setClarifyResponseText("");
    setClarifyResponseFiles([]);
    setShowClarifyResponse(eventId);
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
    from: memo.designation || memo.from.jobTitle || memo.from.department || memo.from.name,
    date: formatDate(memo.startedAt),
    to: [memo.to.name, memo.to.jobTitle].filter(Boolean).join(", "),
    refNumber: memo.referenceNumber,
    subject: memo.subject,
    bodyHtml: memo.body,
    senderName: memo.from.name,
    senderTitle: memo.designation || memo.from.jobTitle || "",
    senderIsSuperior: memo.senderIsSuperior,
    copyTo: (memo.cc ?? []).filter((c) => typeof c === "string" && c.trim().length > 0),
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
  const isSent = memo.status === "SENT";
  const canCirculate = isApproved || isSent;

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">
      {/* Off-screen print document — kept in DOM for html-to-image capture */}
      <div style={{ position: "absolute", left: "-9999px", top: 0, visibility: "hidden", pointerEvents: "none" }}>
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
          {canCirculate && (
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

      {/* Document toolbar — always visible when NOT the user's turn */}
      {!(memo.canAct && memo.currentAction) && (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
          >
            {isDownloading ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            {isDownloading ? "Generating..." : "Download PDF"}
          </button>
          <button
            onClick={handlePreviewTemplate}
            disabled={isGeneratingPreview}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
          >
            {isGeneratingPreview ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            )}
            {isGeneratingPreview ? "Generating..." : "Preview Template"}
          </button>
        </div>
      )}

      {/* Clarification action — shown when this user is the clarification target */}
      {pendingMyClarificationRequests.length > 0 && (
        <div className="bg-karu-green/5 dark:bg-karu-green/10 border border-karu-green/20 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-karu-green flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Clarification requested
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {pendingMyClarificationRequests.length === 1
                  ? "You have been asked to clarify something on this memo. Please respond with your answer and any supporting documents."
                  : `You have ${pendingMyClarificationRequests.length} clarification questions on this memo.`}
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {pendingMyClarificationRequests.map((evt) => {
              const d = evt.data as Record<string, unknown>;
              return (
                <li key={evt.id} className="rounded-lg border border-karu-green/20 bg-white dark:bg-gray-900 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        From {String(d.actorName ?? "a colleague")}
                      </p>
                      {typeof d.question === "string" && (
                        <p className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 break-words">
                          &ldquo;{d.question}&rdquo;
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => openClarifyResponseModal(evt.id)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-karu-green text-white font-medium text-sm transition-colors hover:bg-karu-green-dark shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 0 1 0 1.953l-7.108 4.062A1.125 1.125 0 0 1 3 16.81V8.688ZM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 0 1 0 1.953l-7.108 4.062a1.125 1.125 0 0 1-1.683-.977V8.688Z" />
                      </svg>
                      Answer Clarification
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Action buttons - shown when it's the user's turn */}
      {memo.canAct && memo.currentAction && (
        <div className="bg-karu-green/5 dark:bg-karu-green/10 border border-karu-green/20 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
            This memo requires your{" "}
            {memo.currentAction.type === "APPROVE" ? "approval" : "recommendation"}.
          </p>

          {isWaitingForClarification && (
            <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    Waiting for clarification
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Action buttons are paused until {outstandingClarifications.length === 1 ? "the clarification is" : "all clarifications are"} answered. You&rsquo;ll be notified when a response arrives.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {outstandingClarifications.map((evt) => {
                      const d = evt.data as Record<string, unknown>;
                      const target = (d.targetUserName as string) ?? (d.targetDepartment ? `${d.targetDepartment} department` : "someone");
                      return (
                        <li key={evt.id} className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-amber-600 dark:bg-amber-400" />
                          Awaiting reply from <span className="font-medium">{target}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() =>
                openActionModal(
                  memo.currentAction!.type === "APPROVE"
                    ? "APPROVE"
                    : "RECOMMEND"
                )
              }
              disabled={isWaitingForClarification}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-karu-green"
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
              disabled={isWaitingForClarification}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 font-medium text-sm transition-colors hover:bg-orange-50 dark:hover:bg-orange-950/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
              Return for Revision
            </button>
            <button
              onClick={() => openActionModal("REJECT")}
              disabled={isWaitingForClarification}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 font-medium text-sm transition-colors hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
            {memo.currentAction.type === "APPROVE" && (
              <button
                onClick={() => {
                  setClarifyQuestion("");
                  setClarifyTarget(null);
                  setClarifyDepartment(null);
                  setClarifyMode("user");
                  setClarifySearchResults([]);
                  setClarifySearchQuery("");
                  setShowClarifyModal(true);
                }}
                disabled={isWaitingForClarification}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 font-medium text-sm transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
                Seek Clarification
              </button>
            )}
            {/* Spacer pushes Download/Preview to the right */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleDownloadPdf}
                disabled={isDownloading}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {isDownloading ? (
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                )}
                {isDownloading ? "Generating..." : "Download PDF"}
              </button>
              <button
                onClick={handlePreviewTemplate}
                disabled={isGeneratingPreview}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {isGeneratingPreview ? (
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                )}
                {isGeneratingPreview ? "Generating..." : "Preview Template"}
              </button>
            </div>
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
                {memo.originalInitiatedBy && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 pl-20 -mt-1">
                    Originally drafted by{" "}
                    {memo.originalInitiatedBy.displayName ||
                      memo.originalInitiatedBy.name}
                    {memo.originalInitiatedBy.jobTitle &&
                      `, ${memo.originalInitiatedBy.jobTitle}`}
                    {memo.originalInitiatedBy.department &&
                      ` \u00B7 ${memo.originalInitiatedBy.department}`}
                  </p>
                )}
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

        {/* Attachments */}
        {memo.document?.files && memo.document.files.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-150">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-blue-500/5 to-transparent">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                </svg>
                Supporting Attachments
                <span className="ml-auto text-xs font-normal text-gray-400">{memo.document.files.length} file{memo.document.files.length !== 1 ? "s" : ""}</span>
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {memo.document.files.map((file) => {
                const downloadUrl = file.storagePath
                  ? `/api/files?path=${encodeURIComponent(file.storagePath)}`
                  : null;
                const isImage = file.mimeType.startsWith("image/");
                const isPdf = file.mimeType === "application/pdf";
                return (
                  <div key={file.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-50 dark:bg-blue-900/20">
                      {isPdf ? (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      ) : isImage ? (
                        <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{file.fileName}</p>
                      {file.sizeBytes != null && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {file.sizeBytes < 1024 * 1024
                            ? `${Math.round(file.sizeBytes / 1024)} KB`
                            : `${(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {file.storagePath && (
                        <button
                          onClick={() => setPreviewFile({ fileName: file.fileName, mimeType: file.mimeType, storagePath: file.storagePath! })}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                          title="Preview file"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                          </svg>
                        </button>
                      )}
                      {downloadUrl && (
                        <a
                          href={`${downloadUrl}&download=1`}
                          download={file.fileName}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
                          title="Download file"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                    case "MEMO_CLARIFICATION_REQUESTED":
                      description = `${data.actorName || "User"} requested clarification from ${data.targetUserName || data.targetDepartment || "a user"}`;
                      iconBg = "bg-karu-green";
                      break;
                    case "MEMO_CLARIFICATION_PROVIDED":
                      description = `${data.actorName || "User"} provided clarification`;
                      iconBg = "bg-karu-green-dark";
                      break;
                    default:
                      description = event.eventType.replace(/_/g, " ");
                  }

                  const isClarificationRequest = event.eventType === "MEMO_CLARIFICATION_REQUESTED";
                  const isClarificationResponse = event.eventType === "MEMO_CLARIFICATION_PROVIDED";
                  const userDepartment = (session?.user as { department?: string | null } | undefined)?.department;
                  const isProvided = memo?.events.some(
                    (e) => e.eventType === "MEMO_CLARIFICATION_PROVIDED" &&
                           (e.data as Record<string, unknown>)?.requestEventId === event.id
                  );
                  const canRespondToClarification =
                    isClarificationRequest &&
                    !isProvided &&
                    ((data.targetUserId as string) === session?.user?.id ||
                      (typeof data.targetDepartment === "string" && data.targetDepartment === userDepartment));

                  return (
                    <div key={event.id} className="flex items-start gap-3">
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${iconBg}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {description}
                        </p>
                        {/* Clarification question */}
                        {isClarificationRequest && typeof data.question === "string" && (
                          <p className="text-xs text-karu-green dark:text-emerald-300 mt-1 bg-karu-green/5 dark:bg-karu-green/10 rounded px-2 py-1">
                            Q: {data.question}
                          </p>
                        )}
                        {/* Clarification response */}
                        {isClarificationResponse && typeof data.response === "string" && (
                          <p className="text-xs text-karu-green dark:text-emerald-300 mt-1 bg-karu-green/5 dark:bg-karu-green/10 rounded px-2 py-1">
                            A: {data.response}
                          </p>
                        )}
                        {/* Clarification response attachments */}
                        {isClarificationResponse && Array.isArray(data.attachments) && (data.attachments as unknown[]).length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {(data.attachments as Array<{ id: string; fileName: string; mimeType: string; storagePath: string }>).map((a) => (
                              <li key={a.id}>
                                <button
                                  onClick={() => setPreviewFile({
                                    fileName: a.fileName,
                                    mimeType: a.mimeType,
                                    storagePath: a.storagePath,
                                  })}
                                  className="inline-flex items-center gap-1.5 text-xs text-karu-green dark:text-emerald-400 hover:underline"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                  </svg>
                                  {a.fileName}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {typeof data.comment === "string" && data.comment && !isClarificationRequest && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            &quot;{data.comment}&quot;
                          </p>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {formatDateTime(event.occurredAt)}
                        </p>
                        {/* Respond link — opens the modal at the top */}
                        {canRespondToClarification && (
                          <button
                            onClick={() => openClarifyResponseModal(event.id)}
                            className="mt-1 text-xs text-karu-green hover:underline font-medium"
                          >
                            Answer clarification →
                          </button>
                        )}
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
              {(actionType === "RETURN" || actionType === "REJECT") && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {actionType === "RETURN"
                    ? "Please provide a reason for returning this memo."
                    : "Please provide a reason for rejecting this memo."}
                </p>
              )}

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

              {actionType === "APPROVE" && (
                <div className="space-y-3">
                  <MultiUserInput
                    label="CC additional recipients"
                    sublabel="(receives a copy for information)"
                    users={actionCcUsers}
                    departments={actionCcAllDepts ? [] : actionCcDepts}
                    onAdd={(user) => setActionCcUsers((prev) => [...prev, user])}
                    onRemove={(id) => setActionCcUsers((prev) => prev.filter((u) => u.id !== id))}
                    onAddDepartment={
                      actionCcAllDepts
                        ? undefined
                        : (dept) =>
                            setActionCcDepts((prev) => (prev.includes(dept) ? prev : [...prev, dept]))
                    }
                    onRemoveDepartment={
                      actionCcAllDepts
                        ? undefined
                        : (dept) => setActionCcDepts((prev) => prev.filter((d) => d !== dept))
                    }
                    excludeIds={actionCcUsers.map((u) => u.id)}
                    tagColor="blue"
                  />

                  <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 cursor-pointer hover:border-karu-green transition-colors">
                    <input
                      type="checkbox"
                      checked={actionCcAllDepts}
                      onChange={(e) => {
                        setActionCcAllDepts(e.target.checked);
                        if (e.target.checked) setActionCcDepts([]);
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/30"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                        CC all departments
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Adds a single &ldquo;All Departments&rdquo; line to the memo template.
                      </span>
                    </div>
                  </label>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    These recipients will appear on the final memo template.
                  </p>
                </div>
              )}
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
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Departments
                      </label>
                      {departments.length > 0 && (() => {
                        const allSelected = circulateDepts.length === departments.length;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setCirculateDepts(
                                allSelected ? [] : departments.map((d) => d.name)
                              )
                            }
                            className="text-xs font-medium text-karu-green hover:underline"
                          >
                            {allSelected ? "Clear all" : "Select all departments"}
                          </button>
                        );
                      })()}
                    </div>
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
      {/* Seek Clarification Modal */}
      {showClarifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isClarifying && setShowClarifyModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-lg animate-scale-in">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
                Seek Clarification
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Request clarification from the memo creator or another staff member.
              </p>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Quick actions: memo creator */}
              {memo && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    From
                  </label>

                  {/* Mode toggle: Person / Department */}
                  <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-3">
                    <button
                      type="button"
                      onClick={() => {
                        setClarifyMode("user");
                        setClarifyDepartment(null);
                        setClarifyDeptQuery("");
                        setClarifyDeptDropdownOpen(false);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        clarifyMode === "user"
                          ? "bg-purple-600 text-white"
                          : "bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      Person
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClarifyMode("department");
                        setClarifyTarget(null);
                        setClarifySearchQuery("");
                        setClarifySearchResults([]);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${
                        clarifyMode === "department"
                          ? "bg-purple-600 text-white"
                          : "bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      Department
                    </button>
                  </div>

                  {clarifyMode === "user" && (
                    <>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => setClarifyTarget({
                            id: memo.from.id,
                            name: memo.from.name,
                            displayName: memo.from.name,
                            email: "",
                            department: memo.from.department,
                            jobTitle: memo.from.jobTitle,
                          })}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            clarifyTarget?.id === memo.from.id
                              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                              : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          Memo Creator: {memo.from.name}
                        </button>
                      </div>
                      {/* Or search */}
                      <div className="relative">
                        <input
                          type="text"
                          value={clarifySearchQuery}
                          onChange={(e) => searchClarifyUsers(e.target.value)}
                          placeholder="Or search for another user..."
                          className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                        />
                        {isSearchingClarify && (
                          <div className="absolute right-3 top-2.5">
                            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                          </div>
                        )}
                        {clarifySearchResults.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {clarifySearchResults.map((user) => (
                              <button
                                key={user.id}
                                type="button"
                                onClick={() => {
                                  setClarifyTarget(user);
                                  setClarifySearchQuery("");
                                  setClarifySearchResults([]);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                              >
                                <span className="font-medium text-gray-900 dark:text-gray-100">{user.displayName}</span>
                                {user.jobTitle && <span className="text-xs text-gray-400 ml-2">{user.jobTitle}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {clarifyTarget && clarifyTarget.id !== memo.from.id && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                            {clarifyTarget.displayName}
                          </span>
                          <button onClick={() => setClarifyTarget(null)} className="text-xs text-gray-400 hover:text-gray-600">clear</button>
                        </div>
                      )}
                    </>
                  )}

                  {clarifyMode === "department" && (
                    <>
                      <div className="relative" ref={clarifyDeptRef}>
                        <input
                          type="text"
                          value={clarifyDeptQuery}
                          onChange={(e) => {
                            setClarifyDeptQuery(e.target.value);
                            setClarifyDeptDropdownOpen(true);
                          }}
                          onFocus={() => setClarifyDeptDropdownOpen(true)}
                          placeholder="Search department..."
                          className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
                        />
                        {clarifyDeptDropdownOpen && (() => {
                          const filtered = departments.filter(
                            (d) =>
                              d.name !== clarifyDepartment &&
                              (!clarifyDeptQuery || d.name.toLowerCase().includes(clarifyDeptQuery.toLowerCase()))
                          );
                          if (filtered.length === 0) return null;
                          return (
                            <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {filtered.map((dept) => (
                                <button
                                  key={dept.name}
                                  type="button"
                                  onClick={() => {
                                    setClarifyDepartment(dept.name);
                                    setClarifyDeptQuery("");
                                    setClarifyDeptDropdownOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                                >
                                  <span className="text-gray-900 dark:text-gray-100">{dept.name}</span>
                                  <span className="text-xs text-gray-400">{dept.userCount} staff</span>
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {clarifyDepartment && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                            </svg>
                            {clarifyDepartment}
                          </span>
                          <button onClick={() => setClarifyDepartment(null)} className="text-xs text-gray-400 hover:text-gray-600">clear</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Question */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Question
                </label>
                <textarea
                  value={clarifyQuestion}
                  onChange={(e) => setClarifyQuestion(e.target.value)}
                  rows={3}
                  placeholder="What do you need clarified?"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setShowClarifyModal(false)}
                className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSeekClarification}
                disabled={isClarifying || !clarifyQuestion.trim() || (clarifyMode === "user" ? !clarifyTarget : !clarifyDepartment)}
                className="h-9 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClarifying ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clarification Response Modal */}
      {showClarifyResponse && (() => {
        const requestEvent = memo?.events.find((e) => e.id === showClarifyResponse);
        const question = requestEvent
          ? ((requestEvent.data as Record<string, unknown>)?.question as string | undefined)
          : undefined;
        const requester = requestEvent
          ? ((requestEvent.data as Record<string, unknown>)?.actorName as string | undefined)
          : undefined;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => !isRespondingClarify && setShowClarifyResponse(null)}
            />
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-xl animate-scale-in">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <svg className="w-5 h-5 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                  Answer Clarification
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {requester ? `Reply to ${requester}'s question on this memo.` : "Reply to the clarification question on this memo."}
                </p>
              </div>

              <div className="px-6 py-4 space-y-4">
                {question && (
                  <div className="rounded-lg bg-karu-green/5 dark:bg-karu-green/10 border border-karu-green/20 px-3 py-2.5">
                    <p className="text-xs font-medium text-karu-green dark:text-emerald-400">Question</p>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5 break-words">
                      &ldquo;{question}&rdquo;
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Your response
                  </label>
                  <textarea
                    value={clarifyResponseText}
                    onChange={(e) => setClarifyResponseText(e.target.value)}
                    rows={5}
                    placeholder="Write your answer..."
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Supporting documents <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <label className="flex items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-karu-green dark:hover:border-karu-green bg-gray-50 dark:bg-gray-800/50 cursor-pointer transition-colors">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5" />
                    </svg>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Click to attach files
                    </span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        setClarifyResponseFiles((prev) => [...prev, ...files]);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  {clarifyResponseFiles.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {clarifyResponseFiles.map((file, idx) => (
                        <li
                          key={`${file.name}-${idx}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-4 h-4 text-karu-green dark:text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{file.name}</span>
                            <span className="text-xs text-gray-400 shrink-0">
                              {(file.size / 1024).toFixed(1)} KB
                            </span>
                          </div>
                          <button
                            onClick={() => setClarifyResponseFiles((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-gray-400 hover:text-red-600 transition-colors shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                <button
                  onClick={() => { setShowClarifyResponse(null); setClarifyResponseText(""); setClarifyResponseFiles([]); }}
                  disabled={isRespondingClarify}
                  className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRespondClarification(showClarifyResponse)}
                  disabled={isRespondingClarify || !clarifyResponseText.trim()}
                  className="h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {isRespondingClarify && (
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  )}
                  {isRespondingClarify ? "Sending..." : "Send Response"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Template Preview — iframe viewer (same as file attachment viewer) */}
      {previewTemplateUrl && (
        <div className="fixed top-16 left-0 lg:left-64 right-0 bottom-0 z-20 flex flex-col bg-white dark:bg-gray-950">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-[#02773b] dark:text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {memo.referenceNumber} — Template Preview
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleDownloadPdf}
                disabled={isDownloading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 dark:bg-[#02773b]/20 dark:hover:bg-[#02773b]/30 transition-colors disabled:opacity-60"
              >
                {isDownloading ? (
                  <div className="w-3 h-3 border-2 border-[#02773b]/40 border-t-[#02773b] rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                )}
                {isDownloading ? "Generating..." : "Download PDF"}
              </button>
              <button
                onClick={closeTemplatePreview}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {/* Viewer area — iframe, same as file attachment viewer */}
          <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
            <iframe
              src={previewTemplateUrl}
              className="w-full h-full border-0"
              title="Template Preview"
            />
          </div>
        </div>
      )}

      {/* File Attachment Viewer — covers content area only (below header, right of sidebar) */}
      {previewFile && (
        <div className="fixed top-16 left-0 lg:left-64 right-0 bottom-0 z-20 flex flex-col bg-white dark:bg-gray-950">
          {/* Toolbar — matches records viewer */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-[#02773b] dark:text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{previewFile.fileName}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={`/api/files?path=${encodeURIComponent(previewFile.storagePath)}&download=1`}
                download={previewFile.fileName}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 dark:bg-[#02773b]/20 dark:hover:bg-[#02773b]/30 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download
              </a>
              <button
                onClick={() => setPreviewFile(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {/* Viewer area */}
          <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
            {previewFile.mimeType === "application/pdf" ? (
              <iframe
                src={`/api/files?path=${encodeURIComponent(previewFile.storagePath)}`}
                className="w-full h-full border-0"
                title={previewFile.fileName}
              />
            ) : previewFile.mimeType.startsWith("image/") ? (
              <div className="w-full h-full flex items-center justify-center p-8 overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files?path=${encodeURIComponent(previewFile.storagePath)}`}
                  alt={previewFile.fileName}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                />
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-center px-6 gap-4">
                <svg className="w-16 h-16 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">This file type cannot be previewed in the browser.</p>
                <a
                  href={`/api/files?path=${encodeURIComponent(previewFile.storagePath)}&download=1`}
                  download={previewFile.fileName}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download instead
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
