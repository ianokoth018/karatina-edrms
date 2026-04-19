"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";

/* ---------- types ---------- */

interface CorrespondenceUser {
  id: string;
  name: string;
  displayName: string;
  department?: string;
  jobTitle?: string;
}

interface ActionLog {
  id: string;
  action: string;
  fromStep: string;
  toStep: string;
  actorId: string;
  comment: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  actor: CorrespondenceUser | null;
}

interface DocFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
}

interface LinkedDocument {
  id: string;
  referenceNumber: string;
  title: string;
  status: string;
  files?: DocFile[];
}

interface CorrespondenceDetail {
  id: string;
  type: string;
  referenceNumber: string;
  subject: string;
  fromEntity: string;
  toEntity: string;
  dateReceived: string | null;
  dateSent: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  description: string | null;
  dispatchMethod: string | null;
  trackingNumber: string | null;
  channel: string | null;
  isConfidential: boolean;
  department: string | null;
  currentStep: string;
  slaDeadline: string | null;
  slaBreached: boolean;
  assignedToId: string | null;
  assignedTo: CorrespondenceUser | null;
  assignedRole: string | null;
  createdById: string;
  createdBy: CorrespondenceUser;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  documentId: string | null;
  document: LinkedDocument | null;
  actionLogs: ActionLog[];
  metadata: Record<string, unknown>;
}

interface DepartmentOption {
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
  RECEIVED: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  REGISTERED:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  ASSIGNED:
    "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  IN_PROGRESS:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL:
    "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  APPROVED:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  DISPATCHED:
    "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  CLOSED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  OVERDUE: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  RECEIVED: "Received",
  REGISTERED: "Registered",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  CLOSED: "Closed",
  OVERDUE: "Overdue",
};

const PRIORITY_STYLES: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  NORMAL: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  HIGH: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  URGENT: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const WORKFLOW_STEPS = [
  { key: "CAPTURE", label: "Capture" },
  { key: "REGISTER", label: "Register" },
  { key: "ASSIGN", label: "Assign" },
  { key: "REVIEW", label: "Review" },
  { key: "APPROVAL_MGR", label: "Approval (Mgr)" },
  { key: "APPROVAL_DIR", label: "Approval (Dir)" },
  { key: "DISPATCH", label: "Dispatch" },
  { key: "ARCHIVE", label: "Archive" },
];

const DISPATCH_METHODS = [
  { value: "POST", label: "Post" },
  { value: "COURIER", label: "Courier" },
  { value: "EMAIL", label: "Email" },
  { value: "HAND_DELIVERY", label: "Hand Delivery" },
];

const ACTION_ICONS: Record<string, { icon: string; color: string }> = {
  CAPTURED: { icon: "camera", color: "text-gray-500" },
  REGISTERED: { icon: "clipboard", color: "text-indigo-500" },
  ASSIGNED: { icon: "user-plus", color: "text-purple-500" },
  REVIEWED: { icon: "eye", color: "text-blue-500" },
  FORWARDED: { icon: "arrow-right", color: "text-amber-500" },
  APPROVED: { icon: "check-circle", color: "text-emerald-500" },
  REJECTED: { icon: "x-circle", color: "text-red-500" },
  DISPATCHED: { icon: "truck", color: "text-teal-500" },
  CLOSED: { icon: "archive", color: "text-gray-500" },
  ESCALATED: { icon: "arrow-up", color: "text-orange-500" },
  REASSIGNED: { icon: "refresh", color: "text-violet-500" },
};

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function slaCountdown(deadline: string): { text: string; urgent: boolean; breached: boolean } {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: "Overdue", urgent: true, breached: true };
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours < 1) return { text: `${mins}m remaining`, urgent: true, breached: false };
  if (hours < 24) return { text: `${hours}h ${mins}m remaining`, urgent: hours < 4, breached: false };
  const days = Math.floor(hours / 24);
  return { text: `${days}d ${hours % 24}h remaining`, urgent: days < 1, breached: false };
}

function actionLabel(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------- SVG icon components ---------- */

function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function ChevronLeftIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function ClockIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function DocumentIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function UserIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function ExclamationIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function SpinnerIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function ActionLogIcon({ action }: { action: string }) {
  const config = ACTION_ICONS[action] ?? { icon: "dot", color: "text-gray-400" };
  const base = `w-5 h-5 ${config.color}`;

  switch (config.icon) {
    case "camera":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
        </svg>
      );
    case "clipboard":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.625 2.625 0 0 0 2.625 2.625h5.25a2.625 2.625 0 0 0 2.625-2.625V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664" />
        </svg>
      );
    case "user-plus":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
        </svg>
      );
    case "eye":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
      );
    case "check-circle":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      );
    case "x-circle":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      );
    case "truck":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      );
    case "archive":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
        </svg>
      );
    case "refresh":
      return (
        <svg className={base} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
      );
    default:
      return (
        <div className={`w-2.5 h-2.5 rounded-full bg-gray-400 ${config.color}`} />
      );
  }
}

/* ---------- component ---------- */

export default function CorrespondenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  /* core state */
  const [corr, setCorr] = useState<CorrespondenceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* action form state */
  const [actionComment, setActionComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  /* ASSIGN step state */
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserOption[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  /* DISPATCH step state */
  const [dispatchMethod, setDispatchMethod] = useState("");
  const [dispatchTracking, setDispatchTracking] = useState("");

  /* ---------- data fetching ---------- */

  const fetchCorrespondence = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/correspondence/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to fetch correspondence");
      }
      const data = await res.json();
      setCorr(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/users/search?departments=true");
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCorrespondence();
  }, [fetchCorrespondence]);

  // Fetch departments when ASSIGN step
  useEffect(() => {
    if (corr?.currentStep === "ASSIGN" && departments.length === 0) {
      fetchDepartments();
    }
  }, [corr?.currentStep, departments.length, fetchDepartments]);

  // User search when department changes or query changes
  function handleUserSearch(value: string) {
    setUserSearchQuery(value);
    setShowUserDropdown(true);
    if (userSearchDebounce.current) clearTimeout(userSearchDebounce.current);
    if (value.trim().length < 2) {
      // user search results cleared via handleUserSearch
      return;
    }
    userSearchDebounce.current = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const params = new URLSearchParams();
        params.set("q", value.trim());
        params.set("limit", "10");
        if (selectedDept) params.set("department", selectedDept);
        const res = await fetch(`/api/users/search?${params.toString()}`);
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

  // Close user dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  /* ---------- action handler ---------- */

  async function handleAction(action: string) {
    if (!corr) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { action };
      if (actionComment.trim()) body.comment = actionComment.trim();
      if (action === "ASSIGN" && selectedUser) body.assignToUserId = selectedUser.id;
      if (action === "ASSIGN" && selectedDept) body.department = selectedDept;
      if (action === "DISPATCH") {
        const rd: Record<string, string> = {};
        if (dispatchMethod) rd.dispatchMethod = dispatchMethod;
        if (dispatchTracking.trim()) rd.trackingNumber = dispatchTracking.trim();
        body.responseData = rd;
      }

      const res = await fetch(`/api/correspondence/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to perform action");
      }

      // Reset form state
      setActionComment("");
      setSelectedUser(null);
      handleUserSearch("");
      setSelectedDept("");
      setDispatchMethod("");
      setDispatchTracking("");
      setSuccessMsg(`Action "${actionLabel(action)}" completed successfully.`);

      // Refetch
      fetchCorrespondence();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ---------- workflow step helpers ---------- */

  function getVisibleSteps() {
    const isHighPriority = corr?.priority === "HIGH" || corr?.priority === "URGENT";
    return WORKFLOW_STEPS.filter(
      (s) => s.key !== "APPROVAL_DIR" || isHighPriority
    );
  }

  function getStepStatus(stepKey: string): "completed" | "current" | "pending" {
    if (!corr) return "pending";
    const steps = WORKFLOW_STEPS.map((s) => s.key);
    const currentIdx = steps.indexOf(corr.currentStep);
    const stepIdx = steps.indexOf(stepKey);
    if (stepIdx < currentIdx) return "completed";
    if (stepIdx === currentIdx) return "current";
    return "pending";
  }

  /* ---------- loading skeleton ---------- */

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-5">
        {/* Header skeleton */}
        <div className="space-y-3">
          <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-8 w-96 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="flex gap-2">
            <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
            <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
          </div>
        </div>
        {/* Progress bar skeleton */}
        <div className="h-20 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
        {/* Content skeleton */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2 space-y-5">
            <div className="h-64 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
            <div className="h-48 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
          </div>
          <div className="space-y-5">
            <div className="h-48 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
            <div className="h-64 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  /* ---------- error state ---------- */

  if (error && !corr) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-6 py-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <Link
            href="/correspondence"
            className="text-sm text-karu-green hover:underline mt-2 inline-block"
          >
            Back to Correspondence
          </Link>
        </div>
      </div>
    );
  }

  if (!corr) return null;

  const visibleSteps = getVisibleSteps();
  const sla = corr.slaDeadline ? slaCountdown(corr.slaDeadline) : null;

  /* ---------- render ---------- */

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">
      {/* ====== HEADER ====== */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
            <Link
              href="/correspondence"
              className="inline-flex items-center gap-1 hover:text-karu-green transition-colors"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              Correspondence
            </Link>
            <ChevronRightIcon />
            <span className="font-mono text-gray-700 dark:text-gray-300">
              {corr.referenceNumber}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {corr.subject}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start shrink-0">
          {/* Status badge */}
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              STATUS_STYLES[corr.status] ?? STATUS_STYLES.DRAFT
            }`}
          >
            {STATUS_LABELS[corr.status] ?? corr.status}
          </span>

          {/* Priority badge */}
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              PRIORITY_STYLES[corr.priority] ?? PRIORITY_STYLES.NORMAL
            }`}
          >
            {PRIORITY_LABELS[corr.priority] ?? corr.priority}
          </span>

          {/* SLA indicator */}
          {corr.slaBreached && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">
              <ExclamationIcon className="w-3.5 h-3.5" />
              SLA BREACHED
            </span>
          )}
          {sla && !corr.slaBreached && (
            <span
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                sla.urgent
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              }`}
            >
              <ClockIcon className="w-3.5 h-3.5" />
              {sla.text}
            </span>
          )}

          {/* Confidential badge */}
          {corr.isConfidential && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              Confidential
            </span>
          )}
        </div>
      </div>

      {/* ====== ALERTS ====== */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-3">
          <ExclamationIcon className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {successMsg && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-start gap-3">
          <CheckIcon className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400 flex-1">{successMsg}</p>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ====== WORKFLOW PROGRESS BAR ====== */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 sm:p-5 animate-slide-up">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
          Workflow Progress
        </h3>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {visibleSteps.map((step, idx) => {
            const status = getStepStatus(step.key);
            const isLast = idx === visibleSteps.length - 1;
            return (
              <div key={step.key} className="flex items-center shrink-0">
                {/* Step circle + label */}
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                      status === "completed"
                        ? "bg-emerald-500 text-white"
                        : status === "current"
                        ? "bg-[#02773b] text-white ring-4 ring-[#02773b]/20 animate-pulse"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {status === "completed" ? (
                      <CheckIcon className="w-4 h-4" />
                    ) : (
                      <span className="text-xs">{idx + 1}</span>
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      status === "completed"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : status === "current"
                        ? "text-[#02773b] dark:text-emerald-400 font-semibold"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div
                    className={`w-8 sm:w-12 lg:w-16 h-0.5 mx-1 mt-[-18px] ${
                      status === "completed"
                        ? "bg-emerald-500"
                        : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ====== MAIN CONTENT — TWO COLUMN ====== */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* ---- LEFT COLUMN (wider) ---- */}
        <div className="xl:col-span-2 space-y-5">
          {/* Correspondence Details Card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm animate-slide-up">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <DocumentIcon className="w-5 h-5 text-gray-400" />
                Correspondence Details
              </h2>
            </div>
            <div className="p-5">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {corr.type === "INCOMING" ? "Incoming" : corr.type === "OUTGOING" ? "Outgoing" : "Internal"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Channel
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {corr.channel?.replace(/_/g, " ") ?? "N/A"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    From
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {corr.fromEntity}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    To
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {corr.toEntity}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Department
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {corr.department ?? "Not assigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Tracking Number
                  </dt>
                  <dd className="mt-1 text-sm font-mono text-gray-900 dark:text-gray-100">
                    {corr.trackingNumber ?? "N/A"}
                  </dd>
                </div>
                {corr.dateReceived && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date Received
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {formatDateTime(corr.dateReceived)}
                    </dd>
                  </div>
                )}
                {corr.dateSent && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date Sent
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {formatDateTime(corr.dateSent)}
                    </dd>
                  </div>
                )}
                {corr.dueDate && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Due Date
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {formatDate(corr.dueDate)}
                    </dd>
                  </div>
                )}
                {corr.dispatchMethod && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Dispatch Method
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {corr.dispatchMethod.replace(/_/g, " ")}
                    </dd>
                  </div>
                )}
              </dl>
              {corr.description && (
                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Description
                  </dt>
                  <dd className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {corr.description}
                  </dd>
                </div>
              )}
            </div>
          </div>

          {/* Linked Document Card */}
          {corr.document && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm animate-slide-up delay-100">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                  </svg>
                  Linked Document
                </h2>
              </div>
              <div className="p-5">
                <Link
                  href={`/documents/${corr.document.id}`}
                  className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-karu-green dark:hover:border-karu-green transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-karu-green/10 flex items-center justify-center shrink-0">
                    <DocumentIcon className="w-5 h-5 text-karu-green" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-karu-green transition-colors truncate">
                      {corr.document.title}
                    </p>
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                      {corr.document.referenceNumber}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-2 ${
                        STATUS_STYLES[corr.document.status] ?? STATUS_STYLES.DRAFT
                      }`}
                    >
                      {corr.document.status}
                    </span>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-karu-green mt-2 shrink-0" />
                </Link>
                {corr.document.files && corr.document.files.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Attached Files
                    </p>
                    {corr.document.files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                        </svg>
                        <span className="truncate">{f.fileName}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {f.mimeType.split("/").pop()?.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== ACTION FORM CARD ====== */}
          <ActionFormCard
            corr={corr}
            actionComment={actionComment}
            setActionComment={setActionComment}
            isSubmitting={isSubmitting}
            handleAction={handleAction}
            departments={departments}
            selectedDept={selectedDept}
            setSelectedDept={setSelectedDept}
            userSearchQuery={userSearchQuery}
            handleUserSearch={handleUserSearch}
            userSearchResults={userSearchResults}
            isSearchingUsers={isSearchingUsers}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            showUserDropdown={showUserDropdown}
            setShowUserDropdown={setShowUserDropdown}
            userDropdownRef={userDropdownRef}
            dispatchMethod={dispatchMethod}
            setDispatchMethod={setDispatchMethod}
            dispatchTracking={dispatchTracking}
            setDispatchTracking={setDispatchTracking}
          />
        </div>

        {/* ---- RIGHT COLUMN (sidebar) ---- */}
        <div className="space-y-5">
          {/* Quick Info Card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm animate-slide-up delay-100">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <UserIcon className="w-5 h-5 text-gray-400" />
                Quick Info
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Assigned To
                </p>
                {corr.assignedTo ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-karu-green/10 flex items-center justify-center text-xs font-bold text-karu-green">
                      {(corr.assignedTo.displayName || corr.assignedTo.name).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {corr.assignedTo.displayName || corr.assignedTo.name}
                      </p>
                      {corr.assignedTo.department && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {corr.assignedTo.department}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500 italic">
                    Not yet assigned
                  </p>
                )}
              </div>

              {corr.assignedRole && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Assigned Role
                  </p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {corr.assignedRole.replace(/_/g, " ")}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Created By
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                    {(corr.createdBy.displayName || corr.createdBy.name).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {corr.createdBy.displayName || corr.createdBy.name}
                    </p>
                    {corr.createdBy.department && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {corr.createdBy.department}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Created Date
                </p>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {formatDateTime(corr.createdAt)}
                </p>
              </div>

              {corr.closedAt && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Closed Date
                  </p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                    {formatDateTime(corr.closedAt)}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Current Step
                </p>
                <p className="mt-1 text-sm font-medium text-[#02773b] dark:text-emerald-400">
                  {WORKFLOW_STEPS.find((s) => s.key === corr.currentStep)?.label ?? corr.currentStep}
                </p>
              </div>
            </div>
          </div>

          {/* Action Timeline Card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm animate-slide-up delay-200">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <ClockIcon className="w-5 h-5 text-gray-400" />
                Action Timeline
              </h2>
            </div>
            <div className="p-5">
              {corr.actionLogs.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-4">
                  No actions recorded yet
                </p>
              ) : (
                <div className="space-y-0">
                  {corr.actionLogs.map((log, idx) => (
                    <div key={log.id} className="relative flex gap-3">
                      {/* Timeline line */}
                      {idx < corr.actionLogs.length - 1 && (
                        <div className="absolute left-[9px] top-7 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                      )}
                      {/* Icon */}
                      <div className="shrink-0 mt-0.5 z-10 bg-white dark:bg-gray-900">
                        <ActionLogIcon action={log.action} />
                      </div>
                      {/* Content */}
                      <div className="pb-5 min-w-0 flex-1">
                        <p className="text-sm text-gray-900 dark:text-gray-100">
                          <span className="font-semibold">{actionLabel(log.action)}</span>
                          {log.actor && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {" "}by {log.actor.displayName || log.actor.name}
                            </span>
                          )}
                        </p>
                        {log.comment && (
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
                            &ldquo;{log.comment}&rdquo;
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                          {timeAgo(log.occurredAt)}
                          <span className="mx-1.5">·</span>
                          {log.fromStep} → {log.toStep}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ACTION FORM CARD — extracted for readability
   ================================================================ */

interface ActionFormProps {
  corr: CorrespondenceDetail;
  actionComment: string;
  setActionComment: (v: string) => void;
  isSubmitting: boolean;
  handleAction: (action: string) => void;
  departments: DepartmentOption[];
  selectedDept: string;
  setSelectedDept: (v: string) => void;
  userSearchQuery: string;
  handleUserSearch: (v: string) => void;
  userSearchResults: UserOption[];
  isSearchingUsers: boolean;
  selectedUser: UserOption | null;
  setSelectedUser: (v: UserOption | null) => void;
  showUserDropdown: boolean;
  setShowUserDropdown: (v: boolean) => void;
  userDropdownRef: React.RefObject<HTMLDivElement | null>;
  dispatchMethod: string;
  setDispatchMethod: (v: string) => void;
  dispatchTracking: string;
  setDispatchTracking: (v: string) => void;
}

function ActionFormCard({
  corr,
  actionComment,
  setActionComment,
  isSubmitting,
  handleAction,
  departments,
  selectedDept,
  setSelectedDept,
  userSearchQuery,
  handleUserSearch,
  userSearchResults,
  isSearchingUsers,
  selectedUser,
  setSelectedUser,
  showUserDropdown,
  setShowUserDropdown,
  userDropdownRef,
  dispatchMethod,
  setDispatchMethod,
  dispatchTracking,
  setDispatchTracking,
}: ActionFormProps) {
  const step = corr.currentStep;

  // Step-specific border color
  const borderColors: Record<string, string> = {
    CAPTURE: "border-gray-300 dark:border-gray-600",
    REGISTER: "border-indigo-300 dark:border-indigo-700",
    ASSIGN: "border-purple-300 dark:border-purple-700",
    REVIEW: "border-blue-300 dark:border-blue-700",
    APPROVAL_MGR: "border-orange-300 dark:border-orange-700",
    APPROVAL_DIR: "border-orange-300 dark:border-orange-700",
    DISPATCH: "border-teal-300 dark:border-teal-700",
    ARCHIVE: "border-gray-300 dark:border-gray-600",
  };

  const stepLabel = WORKFLOW_STEPS.find((s) => s.key === step)?.label ?? step;
  const borderClass = borderColors[step] ?? "border-gray-200 dark:border-gray-800";

  // CLOSED — no action form
  if (step === "CLOSED" || corr.status === "CLOSED") {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow-sm animate-slide-up delay-200">
        <div className="p-5 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            This correspondence has been closed and archived.
          </p>
          {corr.closedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Closed on {formatDateTime(corr.closedAt)}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-2xl border-2 ${borderClass} shadow-sm animate-slide-up delay-200`}>
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          Action Required
        </h2>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-karu-green/10 text-karu-green dark:text-emerald-400">
          {stepLabel} Step
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* ---- CAPTURE step ---- */}
        {step === "CAPTURE" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Submit this correspondence to begin the registration process.
            </p>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Add a note (optional)..."
              rows={2}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <button
              onClick={() => handleAction("SUBMIT")}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <SpinnerIcon /> : <CheckIcon />}
              Submit
            </button>
          </>
        )}

        {/* ---- REGISTER step ---- */}
        {step === "REGISTER" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Register this correspondence. A tracking number will be auto-generated.
            </p>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Registration notes (optional)..."
              rows={2}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <button
              onClick={() => handleAction("REGISTER")}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-indigo-600 text-white font-medium text-sm transition-all hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <SpinnerIcon /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.625 2.625 0 0 0 2.625 2.625h5.25a2.625 2.625 0 0 0 2.625-2.625V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664" />
                </svg>
              )}
              Register
            </button>
          </>
        )}

        {/* ---- ASSIGN step ---- */}
        {step === "ASSIGN" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Assign this correspondence to a department and staff member for review.
            </p>
            {/* Department dropdown */}
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Department
              </label>
              <select
                value={selectedDept}
                onChange={(e) => {
                  setSelectedDept(e.target.value);
                  setSelectedUser(null);
                  handleUserSearch("");
                  // user search results cleared via handleUserSearch
                }}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-1 focus:ring-karu-green"
              >
                <option value="">Select department...</option>
                {departments.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} ({d.userCount})
                  </option>
                ))}
              </select>
            </div>

            {/* User search */}
            <div ref={userDropdownRef} className="relative">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Assign To
              </label>
              {selectedUser ? (
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-karu-green bg-karu-green/5 dark:bg-karu-green/10">
                  <div className="w-7 h-7 rounded-full bg-karu-green/20 flex items-center justify-center text-xs font-bold text-karu-green">
                    {(selectedUser.displayName || selectedUser.name).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {selectedUser.displayName || selectedUser.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {[selectedUser.jobTitle, selectedUser.department].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedUser(null);
                      handleUserSearch("");
                    }}
                    className="shrink-0 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => handleUserSearch(e.target.value)}
                    onFocus={() => userSearchResults.length > 0 && setShowUserDropdown(true)}
                    placeholder="Search by name or email..."
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green"
                  />
                  {showUserDropdown && (userSearchResults.length > 0 || isSearchingUsers) && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {isSearchingUsers && (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
                          <SpinnerIcon className="w-4 h-4" /> Searching...
                        </div>
                      )}
                      {userSearchResults.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            setSelectedUser(u);
                            setShowUserDropdown(false);
                            handleUserSearch("");
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                            {(u.displayName || u.name).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {u.displayName || u.name}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {[u.jobTitle, u.department].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Assignment notes (optional)..."
              rows={2}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <button
              onClick={() => handleAction("ASSIGN")}
              disabled={isSubmitting || !selectedUser}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-purple-600 text-white font-medium text-sm transition-all hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <SpinnerIcon /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                </svg>
              )}
              Assign
            </button>
          </>
        )}

        {/* ---- REVIEW step ---- */}
        {step === "REVIEW" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Review the correspondence and take action.
            </p>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Add your review comments..."
              rows={3}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleAction("APPROVE")}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <SpinnerIcon /> : <CheckIcon />}
                Approve
              </button>
              <button
                onClick={() => handleAction("FORWARD")}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 font-medium text-sm transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
                Forward
              </button>
              <button
                onClick={() => {
                  if (!actionComment.trim()) {
                    setActionComment("");
                    return;
                  }
                  handleAction("ADD_COMMENT");
                }}
                disabled={isSubmitting || !actionComment.trim()}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                </svg>
                Add Comment
              </button>
            </div>
          </>
        )}

        {/* ---- APPROVAL_MGR / APPROVAL_DIR step ---- */}
        {(step === "APPROVAL_MGR" || step === "APPROVAL_DIR") && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {step === "APPROVAL_MGR"
                ? "Manager approval required for this correspondence."
                : "Director approval required (high priority item)."}
            </p>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Add approval comments..."
              rows={3}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleAction("APPROVE")}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <SpinnerIcon /> : <CheckIcon />}
                Approve
              </button>
              <button
                onClick={() => {
                  if (!actionComment.trim()) return;
                  handleAction("REJECT");
                }}
                disabled={isSubmitting || !actionComment.trim()}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 font-medium text-sm transition-colors hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
                Reject
              </button>
            </div>
            {(step === "APPROVAL_MGR" || step === "APPROVAL_DIR") && !actionComment.trim() && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                A comment is required to reject.
              </p>
            )}
          </>
        )}

        {/* ---- DISPATCH step ---- */}
        {step === "DISPATCH" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Mark this correspondence as dispatched.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Dispatch Method
              </label>
              <select
                value={dispatchMethod}
                onChange={(e) => setDispatchMethod(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-1 focus:ring-karu-green"
              >
                <option value="">Select method...</option>
                {DISPATCH_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Tracking Number
              </label>
              <input
                type="text"
                value={dispatchTracking}
                onChange={(e) => setDispatchTracking(e.target.value)}
                placeholder="Enter tracking number (if applicable)..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green"
              />
            </div>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Dispatch notes (optional)..."
              rows={2}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <button
              onClick={() => handleAction("DISPATCH")}
              disabled={isSubmitting || !dispatchMethod}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-teal-600 text-white font-medium text-sm transition-all hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <SpinnerIcon /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
              )}
              Mark as Dispatched
            </button>
          </>
        )}

        {/* ---- ARCHIVE step ---- */}
        {step === "ARCHIVE" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Close and archive this correspondence. This action is final.
            </p>
            <textarea
              value={actionComment}
              onChange={(e) => setActionComment(e.target.value)}
              placeholder="Closing notes (optional)..."
              rows={2}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-karu-green focus:ring-1 focus:ring-karu-green resize-none"
            />
            <button
              onClick={() => handleAction("CLOSE")}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-gray-700 dark:bg-gray-600 text-white font-medium text-sm transition-all hover:bg-gray-800 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <SpinnerIcon /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
              )}
              Close & Archive
            </button>
          </>
        )}
      </div>
    </div>
  );
}
