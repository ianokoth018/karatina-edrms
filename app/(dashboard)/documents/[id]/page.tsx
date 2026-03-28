"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */

interface DocumentFile {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  ocrStatus: string;
  uploadedAt: string;
}

interface DocumentVersion {
  id: string;
  versionNum: number;
  storagePath: string;
  sizeBytes: string;
  changeNote: string;
  createdById: string;
  createdAt: string;
}

interface DocumentTag {
  id: string;
  tag: string;
}

interface AccessControl {
  id: string;
  userId: string | null;
  roleId: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canShare: boolean;
}

interface AuditLogEntry {
  id: string;
  action: string;
  occurredAt: string;
  user: { id: string; name: string; displayName: string } | null;
  metadata: Record<string, unknown>;
}

interface WorkflowRef {
  id: string;
  referenceNumber: string;
  status: string;
  subject: string;
}

interface DocumentDetail {
  id: string;
  referenceNumber: string;
  title: string;
  description: string | null;
  documentType: string;
  status: string;
  department: string;
  isVitalRecord: boolean;
  isOnLegalHold: boolean;
  legalHoldReason: string | null;
  checkoutUserId: string | null;
  checkoutAt: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; displayName: string; email: string };
  classificationNode: { id: string; code: string; title: string; level: number } | null;
  files: DocumentFile[];
  versions: DocumentVersion[];
  tags: DocumentTag[];
  accessControls: AccessControl[];
  workflowInstances: WorkflowRef[];
  auditLogs: AuditLogEntry[];
}

/* ---------- constants ---------- */

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  CHECKED_OUT: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  ARCHIVED: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  PENDING_DISPOSAL: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  DISPOSED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAuditAction(action: string): string {
  return action
    .replace(/^document\./, "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------- component ---------- */

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const versionInputRef = useRef<HTMLInputElement>(null);

  /* state */
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "versions" | "access" | "audit">("details");

  /* edit mode */
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  /* version upload */
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const [versionChangeNote, setVersionChangeNote] = useState("");

  /* confirm delete */
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  /* fetch document */
  async function fetchDocument() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to load document");
      }
      const data = await res.json();
      setDoc(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchDocument();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* edit handlers */
  function startEditing() {
    if (!doc) return;
    setEditTitle(doc.title);
    setEditDescription(doc.description ?? "");
    setEditTags(doc.tags.map((t) => t.tag).join(", "));
    setIsEditing(true);
  }

  async function saveEdits() {
    if (!doc) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          tags: editTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save");
      }
      setIsEditing(false);
      await fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  /* checkout / checkin */
  async function handleCheckout() {
    if (!doc) return;
    const isCheckedOut = doc.status === "CHECKED_OUT";
    try {
      const res = await fetch(`/api/documents/${id}/checkout`, {
        method: isCheckedOut ? "DELETE" : "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Operation failed");
      }
      await fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  /* upload new version */
  async function handleVersionUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !doc) return;

    setIsUploadingVersion(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("changeNote", versionChangeNote || `Version uploaded: ${file.name}`);

      const res = await fetch(`/api/documents/${id}/versions`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Upload failed");
      }
      setVersionChangeNote("");
      await fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Version upload failed");
    } finally {
      setIsUploadingVersion(false);
      if (versionInputRef.current) versionInputRef.current.value = "";
    }
  }

  /* delete (dispose) */
  async function handleDelete() {
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Delete failed");
      }
      router.push("/documents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setShowDeleteConfirm(false);
    }
  }

  /* loading state */
  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-64 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
      </div>
    );
  }

  if (error && !doc) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-6 py-8 text-center">
          <svg className="mx-auto w-12 h-12 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-red-700 dark:text-red-400 font-medium">{error}</p>
          <Link href="/documents" className="inline-flex items-center gap-2 mt-4 text-sm text-karu-green hover:underline">
            Back to Documents
          </Link>
        </div>
      </div>
    );
  }

  if (!doc) return null;

  const isPdf = doc.files[0]?.mimeType === "application/pdf";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <Link
          href="/documents"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">{doc.title}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[doc.status] ?? STATUS_STYLES.DRAFT}`}>
              {doc.status.replace(/_/g, " ")}
            </span>
            {doc.isVitalRecord && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-karu-gold-light text-karu-gold dark:bg-karu-gold/10">
                Vital Record
              </span>
            )}
            {doc.isOnLegalHold && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                Legal Hold
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">{doc.referenceNumber}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isEditing && doc.status !== "DISPOSED" && (
            <>
              <button
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                Edit
              </button>

              <button
                onClick={handleCheckout}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
                  doc.status === "CHECKED_OUT"
                    ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {doc.status === "CHECKED_OUT" ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
                    </svg>
                    Check In
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15M9 12l3 3m0 0 3-3m-3 3V2.25" />
                    </svg>
                    Check Out
                  </>
                )}
              </button>

              <Link
                href={`/workflows?documentId=${doc.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
                </svg>
                Start Workflow
              </Link>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 animate-slide-up">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-6 w-full max-w-sm animate-scale-in">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Dispose Document</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              This will mark the document as disposed. This action can only be reversed by an administrator.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Dispose
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File preview */}
      {doc.files.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-100">
          {isPdf ? (
            <div className="relative">
              <iframe
                src={`/${doc.files[0].storagePath}`}
                className="w-full h-[500px] border-0"
                title="Document preview"
              />
            </div>
          ) : (
            <div className="p-6 flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{doc.files[0].fileName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(doc.files[0].sizeBytes)}</p>
              </div>
              <a
                href={`/${doc.files[0].storagePath}`}
                download
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download
              </a>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex gap-6">
          {(["details", "versions", "access", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-karu-green text-karu-green"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "versions" && doc.versions.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                  {doc.versions.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="animate-slide-up delay-200">
        {/* Details tab */}
        {activeTab === "details" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Edit form or display */}
              {isEditing ? (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit Document</h3>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Title</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Description</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Tags</label>
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="Comma-separated tags"
                      className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdits}
                      disabled={isSaving}
                      className="h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors"
                    >
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                  {doc.description ? (
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{doc.description}</p>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500 italic">No description provided</p>
                  )}

                  {/* Tags */}
                  {doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      {doc.tags.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-karu-green-light text-karu-green dark:bg-karu-green/10"
                        >
                          {t.tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Files list */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Files</h3>
                  {doc.status !== "DISPOSED" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={versionChangeNote}
                        onChange={(e) => setVersionChangeNote(e.target.value)}
                        placeholder="Change note..."
                        className="h-8 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-karu-green"
                      />
                      <input
                        ref={versionInputRef}
                        type="file"
                        onChange={handleVersionUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => versionInputRef.current?.click()}
                        disabled={isUploadingVersion}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-medium text-karu-green border border-karu-green/30 hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors disabled:opacity-60"
                      >
                        {isUploadingVersion ? "Uploading..." : "Upload New Version"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {doc.files.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                      <div className="flex-shrink-0 text-gray-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{f.fileName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatFileSize(f.sizeBytes)} &middot; {f.mimeType}
                        </p>
                      </div>
                      <a
                        href={`/${f.storagePath}`}
                        download
                        className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar metadata */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Metadata</h3>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Type</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{doc.documentType.replace(/_/g, " ")}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Department</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{doc.department}</dd>
                  </div>
                  {doc.classificationNode && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Classification</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">
                        {doc.classificationNode.code} &mdash; {doc.classificationNode.title}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Created By</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{doc.createdBy.displayName}</dd>
                    <dd className="text-xs text-gray-400 dark:text-gray-500">{doc.createdBy.email}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Created</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{formatDate(doc.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Last Updated</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{formatDate(doc.updatedAt)}</dd>
                  </div>
                  {doc.contentHash && (
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Content Hash</dt>
                      <dd className="font-mono text-xs text-gray-600 dark:text-gray-400 mt-0.5 break-all">{doc.contentHash.slice(0, 16)}...</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Custom metadata */}
              {doc.metadata && Object.keys(doc.metadata).length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Custom Metadata</h3>
                  <dl className="space-y-2 text-sm">
                    {Object.entries(doc.metadata).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-gray-500 dark:text-gray-400">{key}</dt>
                        <dd className="font-medium text-gray-900 dark:text-gray-100 mt-0.5">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Linked workflows */}
              {doc.workflowInstances.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Workflows</h3>
                  <div className="space-y-2">
                    {doc.workflowInstances.map((wf) => (
                      <Link
                        key={wf.id}
                        href={`/workflows/${wf.id}`}
                        className="block p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{wf.referenceNumber}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{wf.subject}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Versions tab */}
        {activeTab === "versions" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Version</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Change Note</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Size</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {doc.versions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                      No version history
                    </td>
                  </tr>
                ) : (
                  doc.versions.map((v) => (
                    <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">v{v.versionNum}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{v.changeNote}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatFileSize(v.sizeBytes)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{formatDate(v.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/${v.storagePath}`}
                          download
                          className="p-1.5 inline-flex rounded-lg text-gray-400 hover:text-karu-green hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Access tab */}
        {activeTab === "access" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">User / Role</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Read</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Write</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Delete</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {doc.accessControls.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                      No specific access controls set. Default permissions apply.
                    </td>
                  </tr>
                ) : (
                  doc.accessControls.map((ac) => (
                    <tr key={ac.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">
                        {ac.userId ? `User: ${ac.userId}` : ac.roleId ? `Role: ${ac.roleId}` : "Unknown"}
                      </td>
                      {([ac.canRead, ac.canWrite, ac.canDelete, ac.canShare] as boolean[]).map((perm, i) => (
                        <td key={i} className="px-4 py-3 text-center">
                          {perm ? (
                            <svg className="w-4 h-4 text-emerald-500 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit tab */}
        {activeTab === "audit" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {doc.auditLogs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                  No audit trail entries
                </div>
              ) : (
                doc.auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mt-0.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{log.user?.displayName ?? "System"}</span>
                        {" "}&mdash;{" "}
                        <span className="text-gray-600 dark:text-gray-400">{formatAuditAction(log.action)}</span>
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(log.occurredAt)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
