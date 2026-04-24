"use client";

import React, { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import CommentsPanel from "@/components/document/comments-panel";
import SignaturePanel from "@/components/document/signature-panel";
import { ShareDialog } from "@/components/document/share-dialog";
import { Can } from "@/components/auth/can";

/* ---------- types ---------- */

interface DocumentFile {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  ocrStatus: string;
  uploadedAt: string;
  renditionPath: string | null;
  renditionStatus: string;
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

interface RelationRow {
  id: string;
  relationType: string;
  note: string | null;
  createdAt: string;
  createdBy: { displayName: string } | null;
  source?: { id: string; referenceNumber: string; title: string; documentType: string; status: string };
  target?: { id: string; referenceNumber: string; title: string; documentType: string; status: string };
}

interface CasefolderField {
  id?: string;
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface CasefolderSummary {
  id: string;
  name: string;
  fields: CasefolderField[] | unknown;
}

interface EffectiveDocumentPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canDownload: boolean;
  canPrint: boolean;
  canCreate: boolean;
  canManageACL: boolean;
  isAdmin: boolean;
  isCreator: boolean;
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
  effectivePermissions?: EffectiveDocumentPermissions;
  casefolder?: CasefolderSummary | null;
}

/** Field-name housekeeping keys that are rendered by other UI elsewhere and
 *  should be skipped in the casefolder metadata card. */
const CASEFOLDER_HIDDEN_FIELDS = new Set<string>([
  "memo_type",
  "memo_category",
  "forwarded_to_hod",
  "hod_name",
  "body_html",
  "bodyHtml",
  "memoReference",
]);

/** Safely coerce the template `fields` Json into the CasefolderField shape. */
function parseCasefolderFields(fields: unknown): CasefolderField[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (f): f is CasefolderField =>
      typeof f === "object" && f !== null && typeof (f as CasefolderField).name === "string"
  );
}

/** Format an arbitrary metadata value into a display string. */
function formatCasefolderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (v === null || v === undefined ? "" : String(v)))
      .filter((s) => s !== "");
    return parts.length ? parts.join(", ") : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Fallback when the API payload predates effectivePermissions: they're on the
 * page, so treat them as view-only. Every mutating action is gated off. */
const VIEW_ONLY_PERMISSIONS: EffectiveDocumentPermissions = {
  canView: true,
  canEdit: false,
  canDelete: false,
  canShare: false,
  canDownload: false,
  canPrint: false,
  canCreate: false,
  canManageACL: false,
  isAdmin: false,
  isCreator: false,
};

/* ---------- effective permissions pill config ---------- */

const EFFECTIVE_PERM_KEYS = [
  "canView",
  "canEdit",
  "canDelete",
  "canShare",
  "canDownload",
  "canPrint",
  "canManageACL",
] as const;

type EffectivePermKey = (typeof EFFECTIVE_PERM_KEYS)[number];

const EFFECTIVE_PERM_LABELS: Record<EffectivePermKey, string> = {
  canView: "View",
  canEdit: "Edit",
  canDelete: "Delete",
  canShare: "Share",
  canDownload: "Download",
  canPrint: "Print",
  canManageACL: "Manage ACL",
};

const EFFECTIVE_PERM_COLORS: Record<EffectivePermKey, { bg: string; text: string; dot: string }> = {
  canView:      { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  canEdit:      { bg: "bg-amber-100 dark:bg-amber-950/50",     text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500" },
  canDelete:    { bg: "bg-red-100 dark:bg-red-950/50",         text: "text-red-700 dark:text-red-400",         dot: "bg-red-500" },
  canShare:     { bg: "bg-purple-100 dark:bg-purple-950/50",   text: "text-purple-700 dark:text-purple-400",   dot: "bg-purple-500" },
  canDownload:  { bg: "bg-teal-100 dark:bg-teal-950/50",       text: "text-teal-700 dark:text-teal-400",       dot: "bg-teal-500" },
  canPrint:     { bg: "bg-indigo-100 dark:bg-indigo-950/50",   text: "text-indigo-700 dark:text-indigo-400",   dot: "bg-indigo-500" },
  canManageACL: { bg: "bg-gray-200 dark:bg-gray-800",          text: "text-gray-700 dark:text-gray-300",       dot: "bg-gray-500" },
};

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
  const searchParams = useSearchParams();
  const versionInputRef = useRef<HTMLInputElement>(null);

  /* state */
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "versions" | "comments" | "signatures" | "access" | "audit" | "relations">("details");
  const [relations, setRelations] = useState<{ outgoing: RelationRow[]; incoming: RelationRow[] } | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [showAddRelation, setShowAddRelation] = useState(false);
  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState("RELATED_TO");
  const [relNote, setRelNote] = useState("");
  const { data: sessionData } = useSession();

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

  /* access control */
  const [showGrantAccess, setShowGrantAccess] = useState(false);

  /* top-level share dialog (distinct from the ACL "Grant Access" modal) */
  const [showShareDialog, setShowShareDialog] = useState(false);

  /* Auto-open Share flow when arriving via `?share=1` from another page. */
  useEffect(() => {
    if (searchParams.get("share") === "1") {
      setShowShareDialog(true);
    }
  }, [searchParams]);

  const [grantType, setGrantType] = useState<"user" | "role">("user");
  const [grantSearch, setGrantSearch] = useState("");
  const [grantSearchResults, setGrantSearchResults] = useState<{ id: string; name: string; displayName?: string; email?: string }[]>([]);
  const [grantSelectedId, setGrantSelectedId] = useState("");
  const [grantSelectedName, setGrantSelectedName] = useState("");
  const [grantPerms, setGrantPerms] = useState({ canRead: true, canWrite: false, canDelete: false, canShare: false });
  const [isGranting, setIsGranting] = useState(false);
  const grantDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* legal hold */
  const [showLegalHold, setShowLegalHold] = useState(false);
  const [legalHoldReason, setLegalHoldReason] = useState("");
  const [isTogglingHold, setIsTogglingHold] = useState(false);

  /* OCR */
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [isRunningOcr, setIsRunningOcr] = useState(false);

  /* version comparison */
  const [compareMode, setCompareMode] = useState(false);
  const [compareV1, setCompareV1] = useState<string | null>(null);
  const [compareV2, setCompareV2] = useState<string | null>(null);
  const [comparisonResult, setComparisonResult] = useState<{
    version1: { id: string; versionNum: number; changeNote: string; sizeBytes: string; storagePath: string; createdAt: string };
    version2: { id: string; versionNum: number; changeNote: string; sizeBytes: string; storagePath: string; createdAt: string };
    changes: { field: string; before: string | null; after: string | null }[];
  } | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  /* access control search */
  function searchGrantTarget(query: string) {
    setGrantSearch(query);
    setGrantSelectedId("");
    setGrantSelectedName("");
    if (grantDebounce.current) clearTimeout(grantDebounce.current);
    if (query.trim().length < 2) { setGrantSearchResults([]); return; }
    grantDebounce.current = setTimeout(async () => {
      try {
        const endpoint = grantType === "user"
          ? `/api/users/search?q=${encodeURIComponent(query.trim())}&limit=8`
          : `/api/admin/roles?q=${encodeURIComponent(query.trim())}`;
        const res = await fetch(endpoint);
        if (res.ok) {
          const data = await res.json();
          setGrantSearchResults(grantType === "user" ? (data.users ?? []) : (data.roles ?? []));
        }
      } catch { /* ignore */ }
    }, 300);
  }

  async function handleGrantAccess() {
    if (!grantSelectedId || !doc) return;
    setIsGranting(true);
    try {
      const body = grantType === "user"
        ? { userId: grantSelectedId, ...grantPerms }
        : { roleId: grantSelectedId, ...grantPerms };
      const res = await fetch(`/api/documents/${id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to grant access");
      }
      setShowGrantAccess(false);
      setGrantSearch("");
      setGrantSelectedId("");
      setGrantSelectedName("");
      setGrantPerms({ canRead: true, canWrite: false, canDelete: false, canShare: false });
      setGrantSearchResults([]);
      fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant access");
    } finally {
      setIsGranting(false);
    }
  }

  async function handleRevokeAccess(accessId: string) {
    try {
      const res = await fetch(`/api/documents/${id}/access`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to revoke access");
      }
      fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke access");
    }
  }

  async function handleToggleLegalHold() {
    if (!doc) return;
    setIsTogglingHold(true);
    try {
      if (doc.isOnLegalHold) {
        const res = await fetch(`/api/documents/${id}/legal-hold`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to release legal hold");
      } else {
        if (!legalHoldReason.trim()) return;
        const res = await fetch(`/api/documents/${id}/legal-hold`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: legalHoldReason.trim() }),
        });
        if (!res.ok) throw new Error("Failed to place legal hold");
      }
      setShowLegalHold(false);
      setLegalHoldReason("");
      fetchDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Legal hold action failed");
    } finally {
      setIsTogglingHold(false);
    }
  }

  /* OCR handlers */
  async function fetchOcrStatus() {
    try {
      const res = await fetch(`/api/documents/${id}/ocr`);
      if (res.ok) {
        const data = await res.json();
        setOcrText(data.ocrText ?? null);
      }
    } catch { /* ignore */ }
  }

  async function handleRunOcr() {
    setIsRunningOcr(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}/ocr`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "OCR processing failed");
      }
      const data = await res.json();
      setOcrText(data.ocrText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR processing failed");
    } finally {
      setIsRunningOcr(false);
    }
  }

  /* version comparison handler */
  async function handleCompareVersions() {
    if (!compareV1 || !compareV2) return;
    setIsComparing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/documents/${id}/versions/compare?v1=${encodeURIComponent(compareV1)}&v2=${encodeURIComponent(compareV2)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Comparison failed");
      }
      const data = await res.json();
      setComparisonResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setIsComparing(false);
    }
  }

  async function loadRelations() {
    setRelationsLoading(true);
    const res = await fetch(`/api/documents/${id}/relations`);
    if (res.ok) setRelations(await res.json());
    setRelationsLoading(false);
  }

  async function addRelation() {
    if (!relTarget.trim()) return;
    const res = await fetch(`/api/documents/${id}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: relTarget.trim(), relationType: relType, note: relNote || undefined }),
    });
    if (res.ok) { setShowAddRelation(false); setRelTarget(""); setRelNote(""); await loadRelations(); }
  }

  async function removeRelation(relationId: string) {
    await fetch(`/api/documents/${id}/relations/${relationId}`, { method: "DELETE" });
    await loadRelations();
  }

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
    fetchOcrStatus();
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
      <div className="p-6 space-y-6">
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
      <div className="p-6">
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

  const primaryFile = doc.files[0];
  const isPdf = primaryFile?.mimeType === "application/pdf";
  const hasRendition = primaryFile?.renditionStatus === "DONE" && !!primaryFile?.renditionPath;
  const canPreview = isPdf || hasRendition;
  const previewSrc = isPdf
    ? `/api/files?path=${encodeURIComponent(primaryFile.storagePath)}`
    : hasRendition
    ? `/api/files?path=${encodeURIComponent(primaryFile.storagePath)}&rendition=1`
    : null;
  const watermarkedSrc = previewSrc ? `${previewSrc}&watermark=1` : null;
  const perms = doc.effectivePermissions ?? VIEW_ONLY_PERMISSIONS;

  // Watch/subscribe state (lazy-loaded)
  const [subscription, setSubscription] = React.useState<{ events: string[] } | null | undefined>(undefined);
  const [watchLoading, setWatchLoading] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/documents/${id}/subscribe`)
      .then((r) => r.ok ? r.json() : null)
      .then(setSubscription)
      .catch(() => setSubscription(null));
  }, [id]);

  async function toggleWatch() {
    setWatchLoading(true);
    if (subscription) {
      await fetch(`/api/documents/${id}/subscribe`, { method: "DELETE" });
      setSubscription(null);
    } else {
      const res = await fetch(`/api/documents/${id}/subscribe`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (res.ok) setSubscription(await res.json());
    }
    setWatchLoading(false);
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
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
              {perms.canEdit && (
                <Can anyOf={["documents:update", "documents:manage"]}>
                  <button
                    onClick={startEditing}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                    Edit
                  </button>
                </Can>
              )}

              {perms.canEdit && (
                <Can anyOf={["documents:update", "documents:manage"]}>
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
                </Can>
              )}

              <Link
                href={`/workflows?documentId=${doc.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
                </svg>
                Start Workflow
              </Link>

              {/* Watch/Subscribe button */}
              {subscription !== undefined && (
                <button
                  onClick={toggleWatch}
                  disabled={watchLoading}
                  title={subscription ? "Unwatch document" : "Watch document"}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    subscription
                      ? "border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100"
                      : "border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <svg className="w-4 h-4" fill={subscription ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                  </svg>
                  {subscription ? "Watching" : "Watch"}
                </button>
              )}

              {perms.canShare && (
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-karu-green text-karu-green text-sm font-medium hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                  </svg>
                  Share
                </button>
              )}

              {perms.canDelete && (
                <Can anyOf={["documents:delete", "documents:manage"]}>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </Can>
              )}
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

      {/* Two-column body: viewer pinned right on lg+, tabs/content on left */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Right column — File preview. First in DOM so it renders on top on mobile. */}
        <div className="lg:order-2 lg:w-[55%] xl:w-[60%]">
          <div className="lg:sticky lg:top-6">
            {doc.files.length > 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-100 flex flex-col min-h-0">
                {canPreview && previewSrc ? (
                  <div className="relative flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
                    <iframe
                      src={previewSrc}
                      className="w-full h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] min-h-[600px] border-0"
                      title="Document preview"
                    />
                    {/* Viewer toolbar */}
                    <div className="absolute bottom-3 right-3 flex gap-2">
                      {perms.canDownload && (
                        <a
                          href={`/api/files?path=${encodeURIComponent(primaryFile.storagePath)}&download=1`}
                          download
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/90 backdrop-blur border border-gray-200 text-xs font-medium text-gray-700 shadow hover:bg-white transition-colors"
                          title="Download original"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Download
                        </a>
                      )}
                      {perms.canDownload && watermarkedSrc && (
                        <a
                          href={`${watermarkedSrc}&download=1`}
                          download
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-50/90 backdrop-blur border border-amber-200 text-xs font-medium text-amber-700 shadow hover:bg-amber-100 transition-colors"
                          title="Download with watermark"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" /></svg>
                          Watermarked
                        </a>
                      )}
                    </div>
                    {hasRendition && !isPdf && (
                      <div className="absolute top-3 left-3 bg-blue-600/90 text-white text-xs px-2 py-1 rounded-lg backdrop-blur">
                        PDF rendition
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 flex items-center gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{primaryFile.fileName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(primaryFile.sizeBytes)}</p>
                      {primaryFile.renditionStatus === "PENDING" && (
                        <p className="text-xs text-blue-500 mt-0.5">Generating preview…</p>
                      )}
                      {primaryFile.renditionStatus === "FAILED" && (
                        <p className="text-xs text-orange-500 mt-0.5">Preview unavailable for this file type</p>
                      )}
                    </div>
                    {perms.canDownload && (
                      <a
                        href={`/api/files?path=${encodeURIComponent(primaryFile.storagePath)}&download=1`}
                        download
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Download
                      </a>
                    )}
                    {perms.canPrint && (
                      <button
                        type="button"
                        onClick={() => {
                          // Fire-and-forget audit; don't block the print dialog.
                          fetch(`/api/documents/${id}/events`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ type: "printed" }),
                          }).catch(() => {});
                          window.print();
                        }}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-karu-green/30 text-karu-green text-sm font-medium hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
                        </svg>
                        Print
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-10 flex flex-col items-center justify-center text-center animate-slide-up delay-100 min-h-[320px]">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v7.5m2.25-6.466a9.016 9.016 0 0 0-3.461-.203c-.536.072-.974.478-1.021 1.017-.15 1.722.608 3.127 2.096 3.652m5.579-9.848a8.985 8.985 0 0 1-.39 6.157 1.158 1.158 0 0 1-1.239.604l-.285-.054M8.25 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No file attached</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">
                  This document has no files uploaded yet. Upload a new version to attach a file.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Left column — tabs + tab content */}
        <div className="lg:order-1 lg:flex-1 min-w-0 space-y-4">
          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-800">
            <nav className="flex gap-6">
          {(["details", "versions", "comments", "signatures", "access", "relations", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "relations" && !relations) loadRelations();
              }}
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
              {/* Casefolder metadata fields — only when the document is linked
                  to a FormTemplate via metadata.formTemplateId. Mirrors the
                  casefolder file-viewer sidebar styling. */}
              {(() => {
                const cf = doc.casefolder;
                const cfFields = parseCasefolderFields(cf?.fields).filter(
                  (f) => !CASEFOLDER_HIDDEN_FIELDS.has(f.name),
                );
                if (!cf || cfFields.length === 0) return null;
                const rawMetadata = (doc.metadata ?? {}) as Record<string, unknown>;
                return (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                      {cf.name} &mdash; Metadata
                    </h3>
                    <dl className="space-y-3">
                      {cfFields.map((field) => {
                        const raw = rawMetadata[field.name];
                        const display = formatCasefolderValue(raw);
                        return (
                          <div key={field.name} className="space-y-1">
                            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                              {field.label || field.name}
                            </dt>
                            <dd className="text-sm text-gray-900 dark:text-gray-100">
                              {display !== null ? (
                                display
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                );
              })()}

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
                  {doc.status !== "DISPOSED" && perms.canEdit && (
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
                      {perms.canDownload && (
                        <a
                          href={`/api/files?path=${encodeURIComponent(f.storagePath)}&download=1`}
                          download
                          className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* OCR Text section */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0 1 18 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 0 0 6 20.25h1.5M3.75 12h16.5" />
                    </svg>
                    OCR Text
                    {ocrText && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                        {ocrText.length.toLocaleString()} chars
                      </span>
                    )}
                  </h3>
                  {doc.files.length > 0 && (
                    <button
                      onClick={handleRunOcr}
                      disabled={isRunningOcr}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-karu-green border border-karu-green/30 hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors disabled:opacity-60"
                    >
                      {isRunningOcr ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0 1 18 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 0 0 6 20.25h1.5M3.75 12h16.5" />
                          </svg>
                          {ocrText ? "Re-run OCR" : "Run OCR"}
                        </>
                      )}
                    </button>
                  )}
                </div>

                {isRunningOcr ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                      <svg className="w-5 h-5 animate-spin text-karu-green" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing document with OCR...
                    </div>
                  </div>
                ) : ocrText ? (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-800 p-4 text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                    {ocrText}
                  </pre>
                ) : (
                  <div className="py-6 text-center">
                    <svg className="mx-auto w-10 h-10 text-gray-300 dark:text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0 1 18 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 0 0 6 20.25h1.5M3.75 12h16.5" />
                    </svg>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      {doc.files.length > 0
                        ? "No OCR text extracted yet. Click \"Run OCR\" to process this document."
                        : "No files available for OCR processing."}
                    </p>
                  </div>
                )}
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
          <div className="space-y-4">
            {/* Compare mode toggle */}
            {doc.versions.length >= 2 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setCompareMode(!compareMode);
                    setCompareV1(null);
                    setCompareV2(null);
                    setComparisonResult(null);
                  }}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                    compareMode
                      ? "bg-karu-green text-white hover:bg-karu-green-dark"
                      : "border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                  {compareMode ? "Exit Compare" : "Compare Versions"}
                </button>
                {compareMode && compareV1 && compareV2 && (
                  <button
                    onClick={handleCompareVersions}
                    disabled={isComparing}
                    className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-karu-green text-white text-xs font-medium hover:bg-karu-green-dark disabled:opacity-60 transition-colors"
                  >
                    {isComparing ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Comparing...
                      </>
                    ) : (
                      "Compare Selected"
                    )}
                  </button>
                )}
              </div>
            )}

            {compareMode && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Select two versions to compare. Click the radio buttons in the &quot;V1&quot; and &quot;V2&quot; columns.
              </p>
            )}

            {/* Versions table */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    {compareMode && (
                      <>
                        <th className="text-center px-2 py-3 font-medium text-gray-500 dark:text-gray-400 w-12">V1</th>
                        <th className="text-center px-2 py-3 font-medium text-gray-500 dark:text-gray-400 w-12">V2</th>
                      </>
                    )}
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
                      <td colSpan={compareMode ? 7 : 5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                        No version history
                      </td>
                    </tr>
                  ) : (
                    doc.versions.map((v) => (
                      <tr
                        key={v.id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                          compareMode && (compareV1 === v.id || compareV2 === v.id)
                            ? "bg-karu-green-light/30 dark:bg-karu-green/5"
                            : ""
                        }`}
                      >
                        {compareMode && (
                          <>
                            <td className="text-center px-2 py-3">
                              <input
                                type="radio"
                                name="compare-v1"
                                checked={compareV1 === v.id}
                                onChange={() => setCompareV1(v.id)}
                                className="h-3.5 w-3.5 accent-karu-green"
                              />
                            </td>
                            <td className="text-center px-2 py-3">
                              <input
                                type="radio"
                                name="compare-v2"
                                checked={compareV2 === v.id}
                                onChange={() => setCompareV2(v.id)}
                                className="h-3.5 w-3.5 accent-karu-green"
                              />
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">v{v.versionNum}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{v.changeNote}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatFileSize(v.sizeBytes)}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{formatDate(v.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          {perms.canDownload && (
                            <a
                              href={`/api/files?path=${encodeURIComponent(v.storagePath)}&download=1`}
                              download
                              className="p-1.5 inline-flex rounded-lg text-gray-400 hover:text-karu-green hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                            </a>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>

            {/* Comparison result panel */}
            {comparisonResult && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <svg className="w-4 h-4 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                    </svg>
                    Comparison: v{comparisonResult.version1.versionNum} vs v{comparisonResult.version2.versionNum}
                  </h3>
                  <button
                    onClick={() => setComparisonResult(null)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {comparisonResult.changes.length === 0 ? (
                  <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
                    No differences found between these versions.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {/* Side-by-side header */}
                    <div className="grid grid-cols-3 px-5 py-2 bg-gray-50 dark:bg-gray-800/30 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <div>Field</div>
                      <div className="text-center">v{comparisonResult.version1.versionNum} (Before)</div>
                      <div className="text-center">v{comparisonResult.version2.versionNum} (After)</div>
                    </div>
                    {comparisonResult.changes.map((change, idx) => (
                      <div key={idx} className="grid grid-cols-3 px-5 py-3 text-sm items-start gap-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{change.field}</div>
                        <div className="text-center">
                          <span className="inline-block px-2 py-1 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs break-all">
                            {change.before ?? "--"}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="inline-block px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs break-all">
                            {change.after ?? "--"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Access & Legal Hold tab */}
        {activeTab === "access" && (
          <div className="space-y-5">
            {/* Legal Hold Card */}
            <div className={`rounded-2xl border overflow-hidden ${doc.isOnLegalHold ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  Legal Hold
                </h3>
                <button
                  onClick={() => {
                    setShowLegalHold(true);
                    setLegalHoldReason(doc.legalHoldReason ?? "");
                  }}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                    doc.isOnLegalHold
                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {doc.isOnLegalHold ? "Release Hold" : "Place on Hold"}
                </button>
              </div>
              <div className="px-5 py-3">
                {doc.isOnLegalHold ? (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-700 dark:text-red-400">Document is under legal hold</p>
                      <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">This document cannot be modified, disposed, or deleted.</p>
                      {doc.legalHoldReason && (
                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
                          <span className="font-medium">Reason:</span> {doc.legalHoldReason}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No legal hold is active on this document. Place a legal hold to prevent modification or disposal.
                  </p>
                )}
              </div>
            </div>

            {/* Access Controls Card */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                  Access Controls
                  <span className="text-xs font-normal text-gray-400">({doc.accessControls.length})</span>
                </h3>
                {perms.canShare && (
                  <button
                    onClick={() => {
                      setShowGrantAccess(true);
                      setGrantSearch("");
                      setGrantSelectedId("");
                      setGrantSelectedName("");
                      setGrantSearchResults([]);
                      setGrantPerms({ canRead: true, canWrite: false, canDelete: false, canShare: false });
                    }}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Grant Access
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">User / Role</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">Read</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">Write</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">Delete</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">Share</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {doc.accessControls.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                        No specific access controls. Default permissions apply.
                      </td>
                    </tr>
                  ) : (
                    doc.accessControls.map((ac) => (
                      <tr key={ac.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              ac.userId ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                            }`}>
                              {ac.userId ? "User" : "Role"}
                            </span>
                            <span className="text-gray-900 dark:text-gray-100 font-medium text-xs">
                              {ac.userId ?? ac.roleId ?? "Unknown"}
                            </span>
                          </div>
                        </td>
                        {([ac.canRead, ac.canWrite, ac.canDelete, ac.canShare] as boolean[]).map((perm, i) => (
                          <td key={i} className="px-3 py-2.5 text-center">
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
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => handleRevokeAccess(ac.id)}
                            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Revoke"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>

            {/* Grant Access Modal */}
            {showGrantAccess && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowGrantAccess(false)} />
                <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-md">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Grant Access</h3>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {/* Type toggle */}
                    <div className="flex gap-2">
                      {(["user", "role"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => { setGrantType(t); setGrantSearch(""); setGrantSelectedId(""); setGrantSelectedName(""); setGrantSearchResults([]); }}
                          className={`flex-1 h-9 rounded-lg text-sm font-medium transition-colors ${
                            grantType === t ? "bg-[#02773b] text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          {t === "user" ? "User" : "Role"}
                        </button>
                      ))}
                    </div>

                    {/* Search */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {grantType === "user" ? "Search User" : "Search Role"}
                      </label>
                      {grantSelectedId ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1">{grantSelectedName}</span>
                          <button onClick={() => { setGrantSelectedId(""); setGrantSelectedName(""); setGrantSearch(""); }} className="text-gray-400 hover:text-red-500">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            value={grantSearch}
                            onChange={(e) => searchGrantTarget(e.target.value)}
                            placeholder={grantType === "user" ? "Search by name or email..." : "Search role name..."}
                            className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                          />
                          {grantSearchResults.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                              {grantSearchResults.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => {
                                    setGrantSelectedId(r.id);
                                    setGrantSelectedName(r.displayName ?? r.name);
                                    setGrantSearchResults([]);
                                    setGrantSearch("");
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                                >
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{r.displayName ?? r.name}</p>
                                  {r.email && <p className="text-xs text-gray-500">{r.email}</p>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Permissions */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["canRead", "canWrite", "canDelete", "canShare"] as const).map((perm) => (
                          <label key={perm} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={grantPerms[perm]}
                              onChange={(e) => setGrantPerms({ ...grantPerms, [perm]: e.target.checked })}
                              className="h-4 w-4 rounded border-gray-300 text-[#02773b] focus:ring-[#02773b] accent-[#02773b]"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                              {perm.replace("can", "")}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                    <button onClick={() => setShowGrantAccess(false)} className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
                    <button
                      onClick={handleGrantAccess}
                      disabled={!grantSelectedId || isGranting}
                      className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGranting ? "Granting..." : "Grant Access"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Legal Hold Modal */}
            {showLegalHold && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowLegalHold(false)} />
                <div className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-sm">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {doc.isOnLegalHold ? "Release Legal Hold" : "Place Legal Hold"}
                    </h3>
                  </div>
                  <div className="px-6 py-4 space-y-3">
                    {doc.isOnLegalHold ? (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Are you sure you want to release the legal hold on this document? It will become eligible for modification and disposal again.
                      </p>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Reason for Legal Hold <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={legalHoldReason}
                          onChange={(e) => setLegalHoldReason(e.target.value)}
                          rows={3}
                          placeholder="e.g., Ongoing litigation — Case Ref #2026-001"
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20 resize-none"
                        />
                      </div>
                    )}
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                    <button onClick={() => setShowLegalHold(false)} className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
                    <button
                      onClick={handleToggleLegalHold}
                      disabled={isTogglingHold || (!doc.isOnLegalHold && !legalHoldReason.trim())}
                      className={`h-9 px-4 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                        doc.isOnLegalHold ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                      }`}
                    >
                      {isTogglingHold ? "Processing..." : doc.isOnLegalHold ? "Release Hold" : "Place Hold"}
                    </button>
                  </div>
                </div>
              </div>
            )}
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

        {/* Comments tab */}
        {activeTab === "comments" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <CommentsPanel
              documentId={doc.id}
              currentUserId={sessionData?.user?.id ?? ""}
            />
          </div>
        )}

        {/* Signatures tab */}
        {activeTab === "signatures" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <SignaturePanel
              documentId={doc.id}
              currentUserId={sessionData?.user?.id ?? ""}
            />
          </div>
        )}
          </div>
          {/* Relations tab */}
          {activeTab === "relations" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Document Relationships</h3>
                <button
                  onClick={() => setShowAddRelation((v) => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-karu-green text-white hover:bg-karu-green-dark"
                >
                  + Add Relation
                </button>
              </div>

              {showAddRelation && (
                <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Target Document ID</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700"
                      placeholder="Paste document ID or reference number"
                      value={relTarget}
                      onChange={(e) => setRelTarget(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Relationship type</label>
                      <select
                        className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700"
                        value={relType}
                        onChange={(e) => setRelType(e.target.value)}
                      >
                        {["RELATED_TO","SUPERSEDES","REPLACES","SUPPORTS","TRANSLATES"].map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Note (optional)</label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-700"
                        value={relNote}
                        onChange={(e) => setRelNote(e.target.value)}
                        placeholder="Short note"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowAddRelation(false)} className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={addRelation} className="text-xs px-3 py-1.5 rounded-lg bg-karu-green text-white hover:bg-karu-green-dark">Save</button>
                  </div>
                </div>
              )}

              {relationsLoading && <p className="text-sm text-gray-500">Loading…</p>}

              {relations && (
                <div className="space-y-4">
                  {/* Outgoing */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">This document…</p>
                    {relations.outgoing.length === 0 ? (
                      <p className="text-xs text-gray-400">No outgoing relations</p>
                    ) : (
                      <div className="space-y-2">
                        {relations.outgoing.map((r) => (
                          <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                            <span className="text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full whitespace-nowrap">
                              {r.relationType.replace(/_/g, " ")}
                            </span>
                            <div className="flex-1 min-w-0">
                              <Link href={`/documents/${r.target?.id}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:underline truncate block">
                                {r.target?.title ?? r.target?.id}
                              </Link>
                              <p className="text-xs text-gray-400">{r.target?.referenceNumber}</p>
                              {r.note && <p className="text-xs text-gray-500 italic mt-0.5">{r.note}</p>}
                            </div>
                            <button onClick={() => removeRelation(r.id)} className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Incoming */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Referenced by…</p>
                    {relations.incoming.length === 0 ? (
                      <p className="text-xs text-gray-400">No incoming relations</p>
                    ) : (
                      <div className="space-y-2">
                        {relations.incoming.map((r) => (
                          <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                            <span className="text-xs font-semibold text-purple-600 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full whitespace-nowrap">
                              {r.relationType.replace(/_/g, " ")}
                            </span>
                            <div className="flex-1 min-w-0">
                              <Link href={`/documents/${r.source?.id}`} className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:underline truncate block">
                                {r.source?.title ?? r.source?.id}
                              </Link>
                              <p className="text-xs text-gray-400">{r.source?.referenceNumber}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* end tab content */}
        </div>
        {/* end left column */}
      </div>
      {/* end two-column body */}

      {/* Top-level Share dialog (distinct from the ACL Grant Access modal) */}
      <ShareDialog
        open={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        documentId={doc.id}
        documentTitle={doc.title}
      />
    </div>
  );
}
