"use client";

import { use, useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface FieldConfig {
  fieldName: string;
  visibility: "visible" | "hidden" | "readonly" | "editable";
}

interface ActionButton {
  id: string;
  label: string;
  action: string;
  color: "green" | "red" | "amber" | "blue" | "purple" | "gray";
  requiresComment: boolean;
  requiresUserSelect: boolean;
  icon?: string;
}

interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label?: string;
    taskType?: string;
    description?: string;
    assigneeRule?: string;
    assigneeValue?: string;
    formTemplateId?: string;
    fieldConfig?: FieldConfig[];
    actionButtons?: ActionButton[];
    stepLayout?: "full" | "split" | "compact";
    showDocumentViewer?: boolean;
    sectionTitle?: string;
    [key: string]: unknown;
  };
}

interface TemplateEdge {
  id: string;
  source: string;
  target: string;
}

interface TemplateDefinition {
  nodes?: TemplateNode[];
  edges?: TemplateEdge[];
  steps?: { index: number; name: string; type: string }[];
}

interface DocumentFile {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string | number;
  uploadedAt: string;
}

interface TaskDocument {
  id: string;
  referenceNumber: string;
  title: string;
  description: string | null;
  documentType: string;
  status: string;
  department: string;
  metadata: Record<string, unknown> | null;
  files: DocumentFile[];
}

interface TaskInstance {
  id: string;
  referenceNumber: string;
  subject: string;
  status: string;
  currentStepIndex: number;
  formData: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  dueAt: string | null;
  template: {
    id: string;
    name: string;
    description: string | null;
    definition: TemplateDefinition;
  };
  document: TaskDocument | null;
}

interface TaskAssignee {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  department: string | null;
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
  assignee: TaskAssignee;
}

interface FormField {
  id?: string;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
}

interface UserResult {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
}

interface SlaEntry {
  taskId: string;
  slaStatus: "on_track" | "at_risk" | "breached";
  hoursRemaining: number | null;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function fileUrl(storagePath: string): string {
  return `/api/files?path=${encodeURIComponent(storagePath)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!n || isNaN(n)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function dueLabel(dueAt: string | null): { text: string; color: string } | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  const hrs = ms / (1000 * 60 * 60);
  if (hrs < 0) return { text: `Overdue by ${Math.abs(Math.round(hrs))}h`, color: "text-red-600 dark:text-red-400" };
  if (hrs < 24) return { text: `Due in ${Math.round(hrs)}h`, color: "text-amber-600 dark:text-amber-400" };
  const days = Math.round(hrs / 24);
  return { text: `Due in ${days}d`, color: "text-gray-500 dark:text-gray-400" };
}

/** Find the matching task node from the template definition by stepName. */
function findTaskNode(
  definition: TemplateDefinition,
  stepName: string,
  stepIndex: number
): TemplateNode | null {
  const nodes = definition.nodes;
  if (!nodes?.length) return null;

  // First try: exact label match
  const byLabel = nodes.find(
    (n) => n.type === "task" && n.data.label === stepName
  );
  if (byLabel) return byLabel;

  // Second try: stripped suffix match (for "(Delegated)" or "(Revision)" tasks)
  const baseName = stepName.replace(/\s*\(.*?\)\s*$/, "").trim();
  const byBase = nodes.find(
    (n) => n.type === "task" && n.data.label === baseName
  );
  if (byBase) return byBase;

  // Third try: BFS order matching by stepIndex
  const edges = definition.edges ?? [];
  const adj: Record<string, string[]> = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const startNodes = nodes.filter((n) => n.type === "start");
  const visited = new Set<string>();
  const queue = startNodes.map((n) => n.id);
  const taskNodes: TemplateNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node?.type === "task") taskNodes.push(node);
    for (const childId of adj[id] ?? []) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return taskNodes[stepIndex] ?? null;
}

/* ================================================================== */
/*  Inline SVG Icons                                                   */
/* ================================================================== */

function IconArrowLeft({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function IconX({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconReturn({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

function IconDelegate({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function IconClock({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconUser({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function IconDocument({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconDownload({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function IconSearch({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconSpinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function IconExclamation({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconFile({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

function IconHash({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.6 19.5m-2.1-19.5-3.6 19.5" />
    </svg>
  );
}

function IconComment({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    </svg>
  );
}

function IconPaperclip({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

function IconReply({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

function IconPencil({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

/* ================================================================== */
/*  Task comment types                                                 */
/* ================================================================== */

interface CommentAuthor {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
}

interface TaskCommentData {
  id: string;
  body: string;
  authorId: string;
  author: CommentAuthor;
  parentId: string | null;
  isInternal: boolean;
  editedAt: string | null;
  createdAt: string;
  replies: TaskCommentData[];
}

interface TaskAttachmentData {
  id: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; name: string; displayName: string | null };
}

/* ================================================================== */
/*  TaskComments component                                             */
/* ================================================================== */

function TaskComments({ taskId, currentUserId }: { taskId: string; currentUserId: string }) {
  const [comments, setComments] = useState<TaskCommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/tasks/${taskId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function postComment(body: string, parentId?: string) {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflows/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), parentId }),
      });
      if (res.ok) {
        setNewBody("");
        setReplyBody("");
        setReplyingTo(null);
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(commentId: string) {
    if (!editBody.trim()) return;
    const res = await fetch(`/api/workflows/tasks/${taskId}/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody.trim() }),
    });
    if (res.ok) {
      setEditingId(null);
      setEditBody("");
      await load();
    }
  }

  async function deleteComment(commentId: string) {
    if (!confirm("Delete this comment?")) return;
    await fetch(`/api/workflows/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
    await load();
  }

  function CommentBubble({ c, depth = 0 }: { c: TaskCommentData; depth?: number }) {
    const isDeleted = c.body === "[deleted]";
    const isOwn = c.authorId === currentUserId;
    const initials = (c.author.displayName || c.author.name)
      .split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

    return (
      <div className={`flex gap-3 ${depth > 0 ? "ml-8 mt-3" : "mt-4"}`}>
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-[#02773b] dark:text-emerald-400 dark:bg-[#02773b]/20">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {c.author.displayName || c.author.name}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{timeAgo(c.createdAt)}</span>
            {c.editedAt && <span className="text-[10px] text-gray-400">(edited)</span>}
            {c.isInternal && (
              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">internal</span>
            )}
          </div>

          {editingId === c.id ? (
            <div className="space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(c.id)}
                  className="text-xs font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] px-3 py-1 rounded-lg transition-colors"
                >Save</button>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded-lg transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <p className={`text-sm leading-relaxed ${isDeleted ? "text-gray-400 italic" : "text-gray-700 dark:text-gray-300"}`}>
              {c.body}
            </p>
          )}

          {!isDeleted && editingId !== c.id && (
            <div className="flex items-center gap-3 mt-1.5">
              {depth === 0 && (
                <button
                  onClick={() => { setReplyingTo(c.id); setReplyBody(""); }}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors"
                >
                  <IconReply className="w-3 h-3" /> Reply
                </button>
              )}
              {isOwn && (
                <>
                  <button
                    onClick={() => { setEditingId(c.id); setEditBody(c.body); }}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors"
                  >
                    <IconPencil className="w-3 h-3" /> Edit
                  </button>
                  <button
                    onClick={() => deleteComment(c.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <IconTrash className="w-3 h-3" /> Delete
                  </button>
                </>
              )}
            </div>
          )}

          {/* Inline reply box */}
          {replyingTo === c.id && (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={2}
                placeholder="Write a reply..."
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 resize-none"
              />
              <div className="flex gap-2">
                <button
                  disabled={submitting || !replyBody.trim()}
                  onClick={() => postComment(replyBody, c.id)}
                  className="text-xs font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50 px-3 py-1 rounded-lg transition-colors"
                >Reply</button>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded-lg transition-colors"
                >Cancel</button>
              </div>
            </div>
          )}

          {/* Nested replies */}
          {c.replies?.map((reply) => (
            <CommentBubble key={reply.id} c={reply} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <IconComment className="w-4 h-4 text-[#02773b] dark:text-emerald-400" />
          Comments
          {comments.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {comments.length}
            </span>
          )}
        </h2>
      </div>

      <div className="px-6 py-4 space-y-0">
        {loading ? (
          <div className="animate-pulse space-y-3 py-4">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-4 w-full bg-gray-100 dark:bg-gray-900 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No comments yet.</p>
        ) : (
          comments.map((c) => <CommentBubble key={c.id} c={c} />)
        )}

        {/* New comment input */}
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={2}
            placeholder="Add a comment..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 resize-none placeholder-gray-400 dark:placeholder-gray-500"
          />
          <div className="flex justify-end">
            <button
              disabled={submitting || !newBody.trim()}
              onClick={() => postComment(newBody)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50 shadow-sm transition-colors"
            >
              {submitting ? <IconSpinner className="w-4 h-4" /> : <IconComment className="w-4 h-4" />}
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TaskAttachments component                                          */
/* ================================================================== */

function TaskAttachments({ taskId, currentUserId }: { taskId: string; currentUserId: string }) {
  const [attachments, setAttachments] = useState<TaskAttachmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/tasks/${taskId}/attachments`);
      if (res.ok) {
        const data = await res.json();
        setAttachments(data.attachments ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setUploadError("File must be under 25 MB.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(`/api/workflows/tasks/${taskId}/attachments`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || "Upload failed");
      } else {
        await load();
      }
    } catch {
      setUploadError("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(attachId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"?`)) return;
    await fetch(`/api/workflows/tasks/${taskId}/attachments/${attachId}`, { method: "DELETE" });
    await load();
  }

  function fileIcon(mime: string) {
    if (mime === "application/pdf") return "📄";
    if (mime.startsWith("image/")) return "🖼️";
    if (mime.includes("word")) return "📝";
    if (mime.includes("sheet") || mime.includes("excel")) return "📊";
    return "📎";
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <IconPaperclip className="w-4 h-4 text-[#02773b] dark:text-emerald-400" />
          Attachments
          {attachments.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {attachments.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 dark:bg-[#02773b]/20 dark:hover:bg-[#02773b]/30 transition-colors disabled:opacity-50"
        >
          {uploading ? <IconSpinner className="w-3.5 h-3.5" /> : <IconPaperclip className="w-3.5 h-3.5" />}
          Upload
        </button>
        <input ref={fileInputRef} type="file" className="sr-only" onChange={handleUpload} />
      </div>

      <div className="px-6 py-4">
        {uploadError && (
          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2">
            <p className="text-sm text-red-700 dark:text-red-400">{uploadError}</p>
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-2 py-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-gray-900 rounded-lg" />
            ))}
          </div>
        ) : attachments.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:border-[#02773b]/40 transition-colors"
          >
            <IconPaperclip className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Drop files or click to upload</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Max 25 MB per file</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2.5 group"
              >
                <span className="text-lg shrink-0">{fileIcon(a.mimeType)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.fileName}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">
                    {formatBytes(a.sizeBytes)} &middot; {(a.uploadedBy.displayName || a.uploadedBy.name)} &middot; {timeAgo(a.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={`/api/workflows/tasks/${taskId}/attachments/${a.id}`}
                    download={a.fileName}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
                    title="Download"
                  >
                    <IconDownload className="w-3.5 h-3.5" />
                  </a>
                  {a.uploadedBy.id === currentUserId && (
                    <button
                      onClick={() => handleDelete(a.id, a.fileName)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Delete"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Return the icon component for an action button color */
function actionIcon(action: string) {
  switch (action) {
    case "APPROVED": return <IconCheck className="w-4 h-4" />;
    case "REJECTED": return <IconX className="w-4 h-4" />;
    case "RETURNED": return <IconReturn className="w-4 h-4" />;
    case "DELEGATED": return <IconDelegate className="w-4 h-4" />;
    default: return <IconCheck className="w-4 h-4" />;
  }
}

/* ================================================================== */
/*  Color maps                                                         */
/* ================================================================== */

const BUTTON_COLORS: Record<string, { bg: string; hover: string; text: string }> = {
  green: {
    bg: "bg-[#02773b]",
    hover: "hover:bg-[#025f2f]",
    text: "text-white",
  },
  red: {
    bg: "bg-red-600",
    hover: "hover:bg-red-700",
    text: "text-white",
  },
  amber: {
    bg: "bg-[#dd9f42]",
    hover: "hover:bg-[#c58c34]",
    text: "text-white",
  },
  blue: {
    bg: "bg-blue-600",
    hover: "hover:bg-blue-700",
    text: "text-white",
  },
  purple: {
    bg: "bg-purple-600",
    hover: "hover:bg-purple-700",
    text: "text-white",
  },
  gray: {
    bg: "bg-gray-600 dark:bg-gray-700",
    hover: "hover:bg-gray-700 dark:hover:bg-gray-600",
    text: "text-white",
  },
};

const SLA_BADGE: Record<string, string> = {
  on_track: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  at_risk: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  breached: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

/* ================================================================== */
/*  Loading skeleton                                                   */
/* ================================================================== */

function LoadingSkeleton() {
  return (
    <div className="animate-pulse p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="h-4 w-48 bg-gray-200 dark:bg-gray-800 rounded" />
      {/* Header card */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 space-y-4">
        <div className="h-6 w-64 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="flex gap-4">
          <div className="h-4 w-32 bg-gray-100 dark:bg-gray-900 rounded" />
          <div className="h-4 w-40 bg-gray-100 dark:bg-gray-900 rounded" />
          <div className="h-4 w-28 bg-gray-100 dark:bg-gray-900 rounded" />
        </div>
      </div>
      {/* Content */}
      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-9 w-full bg-gray-100 dark:bg-gray-900 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 h-96" />
      </div>
      {/* Footer */}
      <div className="flex gap-3 justify-end">
        <div className="h-10 w-28 bg-gray-200 dark:bg-gray-800 rounded-xl" />
        <div className="h-10 w-28 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Error state                                                        */
/* ================================================================== */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center mx-auto mb-5">
          <IconExclamation className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Failed to load task
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/workflows"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back to Tasks
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Completed task banner                                              */
/* ================================================================== */

function CompletedBanner({ task }: { task: WorkflowTask }) {
  const actionLabel = task.action?.replace(/_/g, " ") ?? "Completed";
  const actionColor =
    task.action === "APPROVED"
      ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
      : task.action === "REJECTED"
      ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
      : "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800";
  const textColor =
    task.action === "APPROVED"
      ? "text-emerald-800 dark:text-emerald-300"
      : task.action === "REJECTED"
      ? "text-red-800 dark:text-red-300"
      : "text-amber-800 dark:text-amber-300";

  return (
    <div className={`rounded-xl border px-5 py-4 ${actionColor}`}>
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 text-sm font-semibold ${textColor}`}>
          {task.action === "APPROVED" ? <IconCheck className="w-5 h-5" /> : <IconX className="w-5 h-5" />}
          This task was {actionLabel.toLowerCase()}
        </div>
        {task.completedAt && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            on {formatDateTime(task.completedAt)}
          </span>
        )}
      </div>
      {task.comment && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 pl-7">
          &quot;{task.comment}&quot;
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Form field renderer                                                */
/* ================================================================== */

function FormFieldDisplay({ field, value }: { field: FormField; value: unknown }) {
  const displayValue =
    value !== null && value !== undefined && value !== "" ? String(value) : null;
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {field.label || field.name}
      </dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-800">
        {displayValue ?? (
          <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
        )}
      </dd>
    </div>
  );
}

function FormFieldEditable({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (val: string) => void;
}) {
  const inputCls =
    "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors placeholder-gray-400 dark:placeholder-gray-500";

  if (field.type === "select" && field.options?.length) {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={field.placeholder || ""}
          className={inputCls}
        />
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      </div>
    );
  }

  if (field.type === "email") {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input type="email" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ""} className={inputCls} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {field.label || field.name}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || ""}
        className={inputCls}
      />
    </div>
  );
}

/* ================================================================== */
/*  Document viewer (for split layout right panel)                     */
/* ================================================================== */

function DocumentViewer({
  files,
  selectedIndex,
  onSelectFile,
}: {
  files: DocumentFile[];
  selectedIndex: number;
  onSelectFile: (i: number) => void;
}) {
  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <IconDocument className="w-8 h-8 text-gray-300 dark:text-gray-600" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">No documents attached</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
          This workflow does not have a linked document with files.
        </p>
      </div>
    );
  }

  const file = files[selectedIndex];
  if (!file) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {files.length > 1 ? (
            <div className="flex items-center gap-1">
              {files.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFile(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    i === selectedIndex
                      ? "bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                  title={f.fileName}
                >
                  <IconFile className="w-3.5 h-3.5" />
                  <span className="max-w-[100px] truncate">{f.fileName}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[#02773b] dark:text-emerald-400">
                <IconFile className="w-4 h-4" />
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {file.fileName}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                {formatBytes(file.sizeBytes)}
              </span>
            </div>
          )}
        </div>
        <a
          href={fileUrl(file.storagePath)}
          download={file.fileName}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 dark:bg-[#02773b]/20 dark:hover:bg-[#02773b]/30 transition-colors shrink-0"
        >
          <IconDownload className="w-3.5 h-3.5" />
          Download
        </a>
      </div>

      {/* Viewer */}
      <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
        {isPdf(file.mimeType) ? (
          <iframe src={`${fileUrl(file.storagePath)}#view=FitH&zoom=page-width&toolbar=1&navpanes=0`} className="w-full h-full border-0" title={file.fileName} />
        ) : isImage(file.mimeType) ? (
          <div className="w-full h-full flex items-center justify-center p-6 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(file.storagePath)} alt={file.fileName} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-[#dd9f42]/10 flex items-center justify-center mb-4">
              <IconFile className="w-8 h-8 text-[#dd9f42]" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Preview not available</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 max-w-xs">
              This file type ({file.mimeType}) cannot be previewed in the browser.
            </p>
            <a
              href={fileUrl(file.storagePath)}
              download={file.fileName}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
            >
              <IconDownload className="w-4 h-4" />
              Download {file.fileName}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  User search picker (for delegation/user select)                    */
/* ================================================================== */

function UserSearchPicker({
  selected,
  onSelect,
  onClear,
}: {
  selected: UserResult | null;
  onSelect: (user: UserResult) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.users ?? []);
        }
      } catch {
        /* silently fail */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[#02773b]/30 bg-[#02773b]/5 dark:bg-[#02773b]/10 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center shrink-0">
            <IconUser className="w-3.5 h-3.5 text-[#02773b] dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {selected.displayName || selected.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{selected.email}</p>
          </div>
        </div>
        <button
          onClick={onClear}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users by name or email..."
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors placeholder-gray-400 dark:placeholder-gray-500"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <IconSpinner className="w-4 h-4 text-gray-400" />
          </div>
        )}
      </div>
      {results.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg max-h-48 overflow-y-auto">
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => {
                onSelect(user);
                setQuery("");
                setResults([]);
              }}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-0"
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {user.displayName || user.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {user.email}
                {user.department && ` \u00B7 ${user.department}`}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Action confirmation modal overlay                                  */
/* ================================================================== */

function ActionModal({
  button,
  task,
  onClose,
  onSuccess,
}: {
  button: ActionButton;
  task: WorkflowTask;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [comment, setComment] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (button.requiresComment && !comment.trim()) {
      setError("A comment is required for this action.");
      return;
    }
    if (button.requiresUserSelect && !selectedUser) {
      setError("Please select a user.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        action: button.action,
        comment: comment || `${button.label} via workflow task.`,
      };
      if (button.requiresUserSelect && selectedUser) {
        payload.delegateToUserId = selectedUser.id;
        payload.reason = comment;
      }

      const res = await fetch(`/api/workflows/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to execute action (${res.status})`);
        return;
      }

      onSuccess();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const colors = BUTTON_COLORS[button.color] ?? BUTTON_COLORS.green;
  const showComment = button.requiresComment || button.action === "REJECTED" || button.action === "RETURNED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-lg bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center`}>
              {actionIcon(button.action)}
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {button.label}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {task.stepName} &middot; {task.instance.referenceNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {button.requiresUserSelect && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Select User
              </label>
              <UserSearchPicker
                selected={selectedUser}
                onSelect={setSelectedUser}
                onClear={() => setSelectedUser(null)}
              />
            </div>
          )}

          {showComment && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Comment {button.requiresComment && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Add your comment..."
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors placeholder-gray-400 dark:placeholder-gray-500 resize-none"
              />
            </div>
          )}

          {!showComment && !button.requiresUserSelect && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to <strong>{button.label.toLowerCase()}</strong> this task?
            </p>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold ${colors.bg} ${colors.hover} ${colors.text} shadow-sm transition-colors disabled:opacity-50`}
          >
            {submitting ? (
              <>
                <IconSpinner className="w-4 h-4" />
                Processing...
              </>
            ) : (
              <>
                {actionIcon(button.action)}
                {button.label}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================================================================== */
/*  Default action buttons (fallback when no config)                   */
/* ================================================================== */

const DEFAULT_ACTION_BUTTONS: ActionButton[] = [
  {
    id: "default_approve",
    label: "Approve",
    action: "APPROVED",
    color: "green",
    requiresComment: false,
    requiresUserSelect: false,
  },
  {
    id: "default_reject",
    label: "Reject",
    action: "REJECTED",
    color: "red",
    requiresComment: true,
    requiresUserSelect: false,
  },
  {
    id: "default_return",
    label: "Return",
    action: "RETURNED",
    color: "amber",
    requiresComment: true,
    requiresUserSelect: false,
  },
];

/* ================================================================== */
/*  Main page component                                                */
/* ================================================================== */

export default function WorkflowTaskExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";

  /* ---- Core state ---- */
  const [task, setTask] = useState<WorkflowTask | null>(null);
  const [formTemplate, setFormTemplate] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- SLA ---- */
  const [sla, setSla] = useState<SlaEntry | null>(null);

  /* ---- Edit state (for editable fields) ---- */
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  /* ---- Document viewer ---- */
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  /* ---- Action modal ---- */
  const [activeAction, setActiveAction] = useState<ActionButton | null>(null);

  /* ---- Split layout tab ---- */
  const [splitTab, setSplitTab] = useState<"form" | "comments" | "attachments">("form");

  /* ---- Success state ---- */
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  /* ================================================================ */
  /*  Fetch task data                                                  */
  /* ================================================================ */

  const fetchTask = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch(`/api/workflows/tasks/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load task (${res.status})`);
      }
      const data = await res.json();
      const fetchedTask: WorkflowTask = data.task;
      setTask(fetchedTask);

      // Find the matching node in the template definition
      const definition = fetchedTask.instance.template.definition;
      const node = findTaskNode(definition, fetchedTask.stepName, fetchedTask.stepIndex);

      // If the node has a formTemplateId, fetch the form template
      const formTemplateId = node?.data.formTemplateId;
      if (formTemplateId) {
        try {
          const formRes = await fetch(`/api/forms/${formTemplateId}`);
          if (formRes.ok) {
            const formData = await formRes.json();
            const fields = Array.isArray(formData.fields) ? formData.fields : [];
            setFormTemplate({
              id: formData.id,
              name: formData.name,
              description: formData.description,
              fields,
            });
          }
        } catch {
          /* form template fetch failed, continue without it */
        }
      }

      // Fetch SLA info
      try {
        const slaRes = await fetch("/api/workflows/sla");
        if (slaRes.ok) {
          const slaData = await slaRes.json();
          const match = (slaData.tasks as SlaEntry[])?.find((s) => s.taskId === id);
          if (match) setSla(match);
        }
      } catch {
        /* SLA fetch failed, continue */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  /* ================================================================ */
  /*  Derived data from template node config                           */
  /* ================================================================ */

  const nodeConfig = useMemo(() => {
    if (!task) return null;
    const definition = task.instance.template.definition;
    const node = findTaskNode(definition, task.stepName, task.stepIndex);
    if (!node) return null;
    return {
      fieldConfig: node.data.fieldConfig ?? null,
      actionButtons: node.data.actionButtons ?? null,
      stepLayout: node.data.stepLayout ?? "full",
      showDocumentViewer: node.data.showDocumentViewer ?? false,
      sectionTitle: node.data.sectionTitle ?? null,
      formTemplateId: node.data.formTemplateId ?? null,
    };
  }, [task]);

  const stepLayout = nodeConfig?.stepLayout ?? "full";
  const showDocViewer = nodeConfig?.showDocumentViewer ?? false;

  /** Resolve which layout to use, accounting for document availability. */
  const effectiveLayout = useMemo(() => {
    // If split layout but no document with files, fall back to full
    if (stepLayout === "split") {
      const files = task?.instance.document?.files ?? [];
      if (files.length === 0 && !showDocViewer) return "full";
      return "split";
    }
    return stepLayout;
  }, [stepLayout, showDocViewer, task]);

  /** Resolved fields: from form template or from document metadata. */
  const resolvedFields = useMemo((): FormField[] => {
    if (formTemplate?.fields?.length) {
      return formTemplate.fields;
    }
    // Fall back to document metadata keys
    const meta = task?.instance.document?.metadata;
    if (!meta || typeof meta !== "object") return [];
    return Object.keys(meta).map((key) => ({
      name: key,
      label: key
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase())
        .trim(),
      type: "text",
    }));
  }, [formTemplate, task]);

  /** The metadata values (from document metadata or workflow instance formData). */
  const fieldValues = useMemo((): Record<string, unknown> => {
    const meta = task?.instance.document?.metadata ?? {};
    const formData = task?.instance.formData ?? {};
    return { ...meta, ...formData };
  }, [task]);

  /** Visible fields based on fieldConfig. */
  const visibleFields = useMemo(() => {
    const config = nodeConfig?.fieldConfig;
    if (!config || config.length === 0) {
      // No config: show all as readonly
      return resolvedFields.map((f) => ({ field: f, visibility: "readonly" as const }));
    }
    const configMap = new Map(config.map((c) => [c.fieldName, c.visibility]));
    return resolvedFields
      .map((f) => ({
        field: f,
        visibility: configMap.get(f.name) ?? "readonly" as const,
      }))
      .filter((f) => f.visibility !== "hidden");
  }, [resolvedFields, nodeConfig]);

  /** Initialize edit values for editable fields. */
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const { field, visibility } of visibleFields) {
      if (visibility === "editable") {
        const raw = fieldValues[field.name];
        vals[field.name] = raw !== null && raw !== undefined ? String(raw) : "";
      }
    }
    setEditValues(vals);
  }, [visibleFields, fieldValues]);

  /** Action buttons to render. */
  const actionButtons = useMemo((): ActionButton[] => {
    if (nodeConfig?.actionButtons && nodeConfig.actionButtons.length > 0) {
      return nodeConfig.actionButtons;
    }
    return DEFAULT_ACTION_BUTTONS;
  }, [nodeConfig]);

  /** Document files. */
  const docFiles = task?.instance.document?.files ?? [];

  /* ================================================================ */
  /*  Action handlers                                                  */
  /* ================================================================ */

  function handleActionClick(button: ActionButton) {
    // If the button doesn't need comment or user select, and it's a simple confirm
    // Still show the modal for confirmation
    setActiveAction(button);
  }

  function handleActionSuccess() {
    setActiveAction(null);
    setActionSuccess(`Task ${activeAction?.label?.toLowerCase() ?? "processed"} successfully.`);
    // Refresh the task data
    fetchTask();
    // Auto-redirect after a delay
    setTimeout(() => {
      router.push("/workflows");
    }, 2000);
  }

  function handleEditChange(fieldName: string, value: string) {
    setEditValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  /* ================================================================ */
  /*  Render states                                                    */
  /* ================================================================ */

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onRetry={fetchTask} />;
  if (!task) return <ErrorState message="Task not found" onRetry={fetchTask} />;

  const isPending = task.status === "PENDING";
  const due = dueLabel(task.dueAt);
  const sectionTitle = nodeConfig?.sectionTitle || task.stepName;

  /* ================================================================ */
  /*  Render: Compact layout                                           */
  /* ================================================================ */

  if (effectiveLayout === "compact") {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <Link href="/workflows" className="hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors">
              My Tasks
            </Link>
            <IconChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-900 dark:text-gray-100 font-medium truncate">
              {task.stepName}
            </span>
          </nav>

          {/* Success banner */}
          {actionSuccess && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-5 py-4 flex items-center gap-3">
              <IconCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{actionSuccess}</p>
            </div>
          )}

          {/* Completed banner */}
          {!isPending && <CompletedBanner task={task} />}

          {/* Task card */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
            {/* Gold accent top border */}
            <div className="h-1 bg-gradient-to-r from-[#02773b] via-[#dd9f42] to-[#02773b]" />

            <div className="p-6 space-y-5">
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  {task.instance.subject}
                </h1>
                {task.instance.document && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {task.instance.document.title}
                  </p>
                )}
              </div>

              {/* Info chips */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400">
                  <IconHash className="w-3 h-3" />
                  {task.instance.referenceNumber}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <IconUser className="w-3 h-3" />
                  {task.assignee.displayName || task.assignee.name}
                </span>
                {due && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${due.color} bg-gray-100 dark:bg-gray-800`}>
                    <IconClock className="w-3 h-3" />
                    {due.text}
                  </span>
                )}
                {sla && (
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold uppercase ${SLA_BADGE[sla.slaStatus] ?? SLA_BADGE.on_track}`}>
                    {sla.slaStatus.replace(/_/g, " ")}
                  </span>
                )}
              </div>

              {/* Task description from template */}
              {task.instance.template.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {task.instance.template.description}
                </p>
              )}
            </div>

            {/* Action buttons */}
            {isPending && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-wrap gap-3 justify-end">
                {actionButtons.map((btn) => {
                  const c = BUTTON_COLORS[btn.color] ?? BUTTON_COLORS.green;
                  return (
                    <button
                      key={btn.id}
                      onClick={() => handleActionClick(btn)}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold ${c.bg} ${c.hover} ${c.text} shadow-sm transition-colors`}
                    >
                      {actionIcon(btn.action)}
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comments & Attachments */}
          <TaskComments taskId={id} currentUserId={currentUserId} />
          <TaskAttachments taskId={id} currentUserId={currentUserId} />
        </div>

        {/* Action modal */}
        {activeAction && task && (
          <ActionModal
            button={activeAction}
            task={task}
            onClose={() => setActiveAction(null)}
            onSuccess={handleActionSuccess}
          />
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Full layout                                              */
  /* ================================================================ */

  if (effectiveLayout === "full") {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <Link href="/workflows" className="hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors">
              My Tasks
            </Link>
            <IconChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-900 dark:text-gray-100 font-medium truncate">
              {task.stepName}
            </span>
          </nav>

          {/* Success banner */}
          {actionSuccess && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-5 py-4 flex items-center gap-3">
              <IconCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{actionSuccess}</p>
            </div>
          )}

          {/* Completed banner */}
          {!isPending && <CompletedBanner task={task} />}

          {/* Header card */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-[#02773b] via-[#dd9f42] to-[#02773b]" />
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                    {sectionTitle}
                  </h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {task.instance.subject}
                    {task.instance.document && (
                      <> &middot; {task.instance.document.title}</>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                  isPending
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                    : task.action === "APPROVED"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : task.action === "REJECTED"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}>
                  {isPending ? "Pending" : task.action?.replace(/_/g, " ") ?? task.status}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1.5">
                  <IconHash className="w-3.5 h-3.5 text-[#02773b] dark:text-emerald-500" />
                  {task.instance.referenceNumber}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <IconUser className="w-3.5 h-3.5 text-[#02773b] dark:text-emerald-500" />
                  {task.assignee.displayName || task.assignee.name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <IconClock className="w-3.5 h-3.5 text-[#dd9f42]" />
                  Assigned {timeAgo(task.assignedAt)}
                </span>
                {due && (
                  <span className={`inline-flex items-center gap-1.5 ${due.color}`}>
                    <IconClock className="w-3.5 h-3.5" />
                    {due.text}
                  </span>
                )}
                {sla && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${SLA_BADGE[sla.slaStatus] ?? SLA_BADGE.on_track}`}>
                    {sla.slaStatus.replace(/_/g, " ")}
                    {sla.hoursRemaining !== null && sla.hoursRemaining > 0 && (
                      <> &middot; {Math.round(sla.hoursRemaining)}h left</>
                    )}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <IconDocument className="w-3.5 h-3.5 text-gray-400" />
                  {task.instance.template.name}
                </span>
              </div>
            </div>
          </div>

          {/* Form fields */}
          {visibleFields.length > 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <IconDocument className="w-4 h-4 text-[#02773b] dark:text-emerald-400" />
                  {formTemplate?.name ?? "Document Details"}
                </h2>
                {formTemplate?.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formTemplate.description}</p>
                )}
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {visibleFields.map(({ field, visibility }) => {
                  if (visibility === "editable" && isPending) {
                    return (
                      <FormFieldEditable
                        key={field.name}
                        field={field}
                        value={editValues[field.name] ?? ""}
                        onChange={(val) => handleEditChange(field.name, val)}
                      />
                    );
                  }
                  return (
                    <FormFieldDisplay
                      key={field.name}
                      field={field}
                      value={fieldValues[field.name]}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Document files section (if showDocumentViewer but full layout) */}
          {showDocViewer && docFiles.length > 0 && (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm overflow-hidden">
              <div className="h-[500px]">
                <DocumentViewer
                  files={docFiles}
                  selectedIndex={selectedFileIndex}
                  onSelectFile={setSelectedFileIndex}
                />
              </div>
            </div>
          )}

          {/* Comments & Attachments */}
          <TaskComments taskId={id} currentUserId={currentUserId} />
          <TaskAttachments taskId={id} currentUserId={currentUserId} />

          {/* Action buttons (sticky footer) */}
          {isPending && (
            <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-md border-t border-gray-200 dark:border-gray-800">
              <div className="max-w-4xl mx-auto flex flex-wrap gap-3 justify-end">
                {actionButtons.map((btn) => {
                  const c = BUTTON_COLORS[btn.color] ?? BUTTON_COLORS.green;
                  return (
                    <button
                      key={btn.id}
                      onClick={() => handleActionClick(btn)}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold ${c.bg} ${c.hover} ${c.text} shadow-sm transition-all hover:shadow-md active:scale-[0.98]`}
                    >
                      {actionIcon(btn.action)}
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Action modal */}
        {activeAction && task && (
          <ActionModal
            button={activeAction}
            task={task}
            onClose={() => setActiveAction(null)}
            onSuccess={handleActionSuccess}
          />
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Split layout                                             */
  /* ================================================================ */

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Top bar with breadcrumb and task info */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="px-4 sm:px-6 py-3">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-2">
            <Link href="/workflows" className="hover:text-[#02773b] dark:hover:text-emerald-400 transition-colors">
              My Tasks
            </Link>
            <IconChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-900 dark:text-gray-100 font-medium truncate">
              {task.stepName}
            </span>
          </nav>

          {/* Success banner */}
          {actionSuccess && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-center gap-3 mb-2">
              <IconCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{actionSuccess}</p>
            </div>
          )}

          {/* Completed banner */}
          {!isPending && (
            <div className="mb-2">
              <CompletedBanner task={task} />
            </div>
          )}

          {/* Header info */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                {sectionTitle}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {task.instance.subject}
                {task.instance.document && <> &middot; {task.instance.document.title}</>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                isPending
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                  : task.action === "APPROVED"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : task.action === "REJECTED"
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}>
                {isPending ? "Pending" : task.action?.replace(/_/g, " ") ?? task.status}
              </span>
              {sla && (
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase ${SLA_BADGE[sla.slaStatus] ?? SLA_BADGE.on_track}`}>
                  {sla.slaStatus.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <IconHash className="w-3 h-3 text-[#02773b] dark:text-emerald-500" />
              {task.instance.referenceNumber}
            </span>
            <span className="inline-flex items-center gap-1">
              <IconUser className="w-3 h-3 text-[#02773b] dark:text-emerald-500" />
              {task.assignee.displayName || task.assignee.name}
            </span>
            <span className="inline-flex items-center gap-1">
              <IconClock className="w-3 h-3 text-[#dd9f42]" />
              Assigned {timeAgo(task.assignedAt)}
            </span>
            {due && (
              <span className={`inline-flex items-center gap-1 ${due.color}`}>
                <IconClock className="w-3 h-3" />
                {due.text}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <IconDocument className="w-3 h-3 text-gray-400" />
              {task.instance.template.name}
            </span>
          </div>
        </div>
      </div>

      {/* Split panels */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Tabbed (40%) */}
        <div className="w-[40%] min-w-[320px] max-w-[520px] border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col min-h-0">
          {/* Tab bar */}
          <div className="shrink-0 flex border-b border-gray-200 dark:border-gray-800 px-2 pt-2 gap-1">
            {(["form", "comments", "attachments"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSplitTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-colors border-b-2 -mb-px ${
                  splitTab === tab
                    ? "border-[#02773b] text-[#02773b] dark:text-emerald-400 bg-[#02773b]/5"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                }`}
              >
                {tab === "form" && <IconDocument className="w-3.5 h-3.5" />}
                {tab === "comments" && <IconComment className="w-3.5 h-3.5" />}
                {tab === "attachments" && <IconPaperclip className="w-3.5 h-3.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {splitTab === "form" && (
            <>
              {/* Form header */}
              <div className="shrink-0 px-5 py-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <IconDocument className="w-4 h-4 text-[#02773b] dark:text-emerald-400" />
                  {formTemplate?.name ?? "Document Details"}
                </h2>
                {formTemplate?.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{formTemplate.description}</p>
                )}
              </div>

              {/* Fields */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {visibleFields.length === 0 ? (
                  <div className="text-center py-8">
                    <IconDocument className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No form fields configured for this step.
                    </p>
                  </div>
                ) : (
                  visibleFields.map(({ field, visibility }) => {
                    if (visibility === "editable" && isPending) {
                      return (
                        <FormFieldEditable
                          key={field.name}
                          field={field}
                          value={editValues[field.name] ?? ""}
                          onChange={(val) => handleEditChange(field.name, val)}
                        />
                      );
                    }
                    return (
                      <FormFieldDisplay
                        key={field.name}
                        field={field}
                        value={fieldValues[field.name]}
                      />
                    );
                  })
                )}
              </div>
            </>
          )}

          {splitTab === "comments" && (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <TaskComments taskId={id} currentUserId={currentUserId} />
            </div>
          )}

          {splitTab === "attachments" && (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <TaskAttachments taskId={id} currentUserId={currentUserId} />
            </div>
          )}

          {/* Action buttons at bottom of left panel */}
          {isPending && (
            <div className="shrink-0 px-5 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-wrap gap-2 justify-end">
              {actionButtons.map((btn) => {
                const c = BUTTON_COLORS[btn.color] ?? BUTTON_COLORS.green;
                return (
                  <button
                    key={btn.id}
                    onClick={() => handleActionClick(btn)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold ${c.bg} ${c.hover} ${c.text} shadow-sm transition-all hover:shadow-md active:scale-[0.98]`}
                  >
                    {actionIcon(btn.action)}
                    {btn.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel: Document viewer (60%) */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-gray-100 dark:bg-gray-900">
          <DocumentViewer
            files={docFiles}
            selectedIndex={selectedFileIndex}
            onSelectFile={setSelectedFileIndex}
          />
        </div>
      </div>

      {/* Action modal */}
      {activeAction && task && (
        <ActionModal
          button={activeAction}
          task={task}
          onClose={() => setActiveAction(null)}
          onSuccess={handleActionSuccess}
        />
      )}
    </div>
  );
}
