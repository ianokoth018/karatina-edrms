"use client";

import { use, useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Convert a storagePath to a file-serving API URL for inline preview.
 *  The native Chrome PDF toolbar (with thumbnails + download/print) is
 *  left intact — we favour viewer UX. API still enforces ACL on requests. */
function fileUrl(storagePath: string): string {
  return `/api/files?path=${encodeURIComponent(storagePath)}`;
}

/** Convert a storagePath to a forced-download URL, gated by the API's
 *  `canDownload` check. */
function downloadUrl(storagePath: string): string {
  return `/api/files?path=${encodeURIComponent(storagePath)}&download=1`;
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface CasefolderField {
  id: string;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  hidden?: boolean;
  usedInTitle?: boolean;
  isAggregationKey?: boolean;
  options?: string[];
  placeholder?: string;
}

interface DocumentFile {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string | number;
  uploadedAt: string;
}

interface DocumentVersion {
  id: string;
  versionNum: number;
  storagePath: string;
  sizeBytes: string | number;
  changeNote: string | null;
  createdById: string;
  createdAt: string;
}

interface DocumentCreatedBy {
  id: string;
  name: string;
  displayName: string | null;
  department: string | null;
}

interface EffectiveDocumentPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canDownload: boolean;
  canCreate: boolean;
  canPrint: boolean;
  canManageACL: boolean;
  isAdmin: boolean;
  isCreator: boolean;
}

interface DocumentData {
  id: string;
  referenceNumber: string;
  title: string;
  description: string | null;
  documentType: string;
  status: string;
  department: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  createdBy: DocumentCreatedBy;
  files: DocumentFile[];
  versions: DocumentVersion[];
  effectivePermissions?: EffectiveDocumentPermissions;
}

/** Fallback when the API payload predates effectivePermissions: user is
 *  already on this page so they must have view, but all mutating actions
 *  are gated off. */
const VIEW_ONLY_PERMISSIONS: EffectiveDocumentPermissions = {
  canView: true,
  canEdit: false,
  canDelete: false,
  canShare: false,
  canDownload: false,
  canCreate: false,
  canPrint: false,
  canManageACL: false,
  isAdmin: false,
  isCreator: false,
};

/* ---------- effective permissions pill config (mirrors documents/[id]) ---------- */

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

const EFFECTIVE_PERM_COLORS: Record<
  EffectivePermKey,
  { bg: string; text: string; dot: string }
> = {
  canView:      { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  canEdit:      { bg: "bg-amber-100 dark:bg-amber-950/50",     text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500" },
  canDelete:    { bg: "bg-red-100 dark:bg-red-950/50",         text: "text-red-700 dark:text-red-400",         dot: "bg-red-500" },
  canShare:     { bg: "bg-purple-100 dark:bg-purple-950/50",   text: "text-purple-700 dark:text-purple-400",   dot: "bg-purple-500" },
  canDownload:  { bg: "bg-teal-100 dark:bg-teal-950/50",       text: "text-teal-700 dark:text-teal-400",       dot: "bg-teal-500" },
  canPrint:     { bg: "bg-indigo-100 dark:bg-indigo-950/50",   text: "text-indigo-700 dark:text-indigo-400",   dot: "bg-indigo-500" },
  canManageACL: { bg: "bg-gray-200 dark:bg-gray-800",          text: "text-gray-700 dark:text-gray-300",       dot: "bg-gray-500" },
};

interface CasefolderData {
  id: string;
  name: string;
  fields: CasefolderField[] | unknown;
}

interface ApiResponse {
  document: DocumentData;
  casefolder: CasefolderData;
  fieldValues: Record<string, unknown>;
}

/* ================================================================== */
/*  Inline SVG icons                                                   */
/* ================================================================== */

function IconArrowLeft({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
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

function IconPrinter({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
    </svg>
  );
}

function IconPencil({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function IconX({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
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

function IconFile({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

function IconImage({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
    </svg>
  );
}

function IconPdf({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
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

function IconFolder({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
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

function IconBuilding({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
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

function IconExclamation({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconSpinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function IconVersions({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0L12 17.25 6.43 14.25m11.141 0 4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" />
    </svg>
  );
}

function IconNoDocument({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={0.75} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v7.5m2.25-6.466a9.016 9.016 0 0 0-3.461-.203c-.536.072-.974.478-1.021 1.017-.15 1.722.608 3.127 2.096 3.652m5.579-9.848a8.985 8.985 0 0 1-.39 6.157 1.158 1.158 0 0 1-1.239.604l-.285-.054M8.25 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

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

function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 ring-emerald-600/20";
    case "ARCHIVED":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 ring-amber-600/20";
    case "DRAFT":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ring-gray-500/20";
    case "DISPOSED":
      return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 ring-red-600/20";
    case "UNDER_REVIEW":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 ring-blue-600/20";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ring-gray-500/20";
  }
}

function getFileIcon(mimeType: string) {
  if (isPdf(mimeType)) return <IconPdf className="w-4 h-4" />;
  if (isImage(mimeType)) return <IconImage className="w-4 h-4" />;
  return <IconFile className="w-4 h-4" />;
}

/** Extract a human-readable label from document metadata using usedInTitle fields. */
function getDocLabel(
  metadata: Record<string, unknown>,
  allFields: unknown[],
  fallback: string
): string {
  const titleFields = (allFields as CasefolderField[]).filter((f) => f.usedInTitle);
  if (titleFields.length === 0) return fallback;
  const parts = titleFields
    .map((f) => {
      let val = metadata[f.name];
      if (val === undefined || val === null || val === "") {
        const camel = f.name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
        val = metadata[camel];
      }
      return val !== undefined && val !== null && val !== "" ? String(val) : null;
    })
    .filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

/** Safely cast template fields to our known shape, excluding fields hidden on layout. */
function parseCasefolderFields(fields: unknown): CasefolderField[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (f): f is CasefolderField =>
      typeof f === "object" && f !== null && typeof (f as CasefolderField).name === "string" && !(f as CasefolderField).hidden
  );
}

/* ================================================================== */
/*  Loading skeleton                                                   */
/* ================================================================== */

function LoadingSkeleton() {
  return (
    <div className="flex h-[calc(100vh-4rem)] animate-pulse">
      {/* Left panel skeleton */}
      <div className="w-[35%] min-w-[320px] max-w-[480px] border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 space-y-6 overflow-hidden">
        <div className="h-7 w-48 bg-gray-200 dark:bg-gray-800 rounded-full" />
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-5 w-full bg-gray-100 dark:bg-gray-900 rounded" />
            </div>
          ))}
        </div>
        <div className="h-px bg-gray-200 dark:bg-gray-800" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-100 dark:bg-gray-900 rounded w-full" />
          ))}
        </div>
      </div>
      {/* Right panel skeleton */}
      <div className="flex-1 bg-gray-50 dark:bg-gray-900 p-6">
        <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded-xl mb-4" />
        <div className="h-full bg-gray-200 dark:bg-gray-800 rounded-2xl" />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Error state                                                        */
/* ================================================================== */

function ErrorState({
  message,
  onRetry,
  casefolderId,
}: {
  message: string;
  onRetry: () => void;
  casefolderId: string;
}) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center mx-auto mb-5">
          <IconExclamation className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Failed to load document
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
            href={`/records/casefolders/${casefolderId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back to Casefolder
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Metadata field display & edit                                      */
/* ================================================================== */

function MetadataFieldDisplay({
  field,
  value,
}: {
  field: CasefolderField;
  value: unknown;
}) {
  const displayValue = value !== null && value !== undefined && value !== ""
    ? String(value)
    : null;

  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {field.label || field.name}
      </dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100">
        {displayValue ?? (
          <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
        )}
      </dd>
    </div>
  );
}

function MetadataFieldEdit({
  field,
  value,
  onChange,
}: {
  field: CasefolderField;
  value: string;
  onChange: (val: string) => void;
}) {
  const inputClasses =
    "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] transition-colors placeholder-gray-400 dark:placeholder-gray-500";

  if (field.type === "select" && field.options?.length) {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {field.label || field.name}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
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
          className={inputClasses}
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
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
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
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ""}
          className={inputClasses}
        />
      </div>
    );
  }

  // Default: text input
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
        className={inputClasses}
      />
    </div>
  );
}

/* ================================================================== */
/*  Document viewer (right panel)                                      */
/* ================================================================== */

function DocumentViewer({
  files,
  selectedFileIndex,
  onSelectFile,
  perms,
}: {
  files: DocumentFile[];
  selectedFileIndex: number;
  onSelectFile: (index: number) => void;
  perms: EffectiveDocumentPermissions;
}) {
  if (files.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-5">
          <IconNoDocument className="w-10 h-10 text-gray-300 dark:text-gray-600" />
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
          No documents attached
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          This record has no files uploaded yet. You can attach files by editing the document.
        </p>
      </div>
    );
  }

  const file = files[selectedFileIndex];
  if (!file) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Viewer toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="flex items-center gap-3 min-w-0">
          {/* File selector tabs when multiple files */}
          {files.length > 1 && (
            <div className="flex items-center gap-1 mr-2">
              {files.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFile(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    i === selectedFileIndex
                      ? "bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                  title={f.fileName}
                >
                  {getFileIcon(f.mimeType)}
                  <span className="max-w-[100px] truncate">{f.fileName}</span>
                </button>
              ))}
            </div>
          )}
          {files.length === 1 && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[#02773b] dark:text-emerald-400">
                {getFileIcon(file.mimeType)}
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
      </div>

      {/* Viewer area — explicit viewport-relative height on small screens
       *  so the iframe renders even when its flex parent has no pixel height
       *  (which collapses h-full to 0). lg+ falls back to flex-fill. */}
      <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900 relative">
        {isPdf(file.mimeType) ? (
          <>
            <iframe
              src={`${fileUrl(file.storagePath)}#view=FitH&zoom=page-width&toolbar=1&navpanes=0`}
              className="w-full h-[calc(100vh-12rem)] lg:h-full block border-0"
              title={file.fileName}
            />
            {/* Mobile-friendly "open full screen" pill — hands the user off to
             *  the browser's native PDF viewer where they can pinch-zoom. */}
            <a
              href={fileUrl(file.storagePath)}
              target="_blank"
              rel="noopener noreferrer"
              className="lg:hidden absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-[#02773b] text-white shadow-lg hover:bg-[#025f2f] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
              Open full screen
            </a>
          </>
        ) : isImage(file.mimeType) ? (
          <div className="w-full h-[calc(100vh-12rem)] lg:h-full flex items-center justify-center p-6 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(file.storagePath)}
              alt={file.fileName}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
          </div>
        ) : (
          /* Unsupported type — download prompt */
          <div className="w-full h-[calc(100vh-12rem)] lg:h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-2xl bg-[#dd9f42]/10 flex items-center justify-center mb-5">
              <IconFile className="w-10 h-10 text-[#dd9f42]" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Preview not available
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-xs">
              This file type ({file.mimeType}) cannot be previewed in the browser.
              {perms.canDownload
                ? " Download it to view the contents."
                : " You do not have permission to download this file."}
            </p>
            {perms.canDownload && (
              <a
                href={downloadUrl(file.storagePath)}
                download={file.fileName}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
              >
                <IconDownload className="w-4 h-4" />
                Download {file.fileName}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Version history panel                                              */
/* ================================================================== */

function VersionHistory({ versions }: { versions: DocumentVersion[] }) {
  const [expanded, setExpanded] = useState(false);

  if (versions.length === 0) return null;

  const visibleVersions = expanded ? versions : versions.slice(0, 3);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <IconVersions className="w-3.5 h-3.5" />
        Version History ({versions.length})
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div className="space-y-2">
        {visibleVersions.map((v) => (
          <div
            key={v.id}
            className="flex items-start gap-3 text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-gray-800"
          >
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
              v{v.versionNum}
            </span>
            <div className="min-w-0 flex-1">
              {v.changeNote && (
                <p className="text-gray-700 dark:text-gray-300 mb-0.5">{v.changeNote}</p>
              )}
              <p className="text-gray-400 dark:text-gray-500">
                {formatDateTime(v.createdAt)} &middot; {formatBytes(v.sizeBytes)}
              </p>
            </div>
          </div>
        ))}
      </div>
      {versions.length > 3 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-[#02773b] dark:text-emerald-400 font-medium hover:underline"
        >
          Show {versions.length - 3} more version{versions.length - 3 > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Main page component                                                */
/* ================================================================== */

export default function CasefolderDocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id, docId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const folderKey = searchParams.get("folderKey");

  /* ---- State ---- */
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  /** Mobile-only: which pane is showing. Ignored on lg+ where both are visible. */
  const [mobilePane, setMobilePane] = useState<"viewer" | "details">("viewer");

  /* ---- Sibling docs (folder navigation) ---- */
  const [folderDocs, setFolderDocs] = useState<{ id: string; title: string; referenceNumber: string; status: string; metadata: Record<string, unknown> }[]>([]);
  const [folderDocsLoading, setFolderDocsLoading] = useState(false);

  /* ---- Fetch document data ---- */
  const fetchDocument = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(`/api/records/casefolders/${id}/${docId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load document (${res.status})`);
      }
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [id, docId]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  /* ---- Fetch sibling docs for folder navigation ---- */
  useEffect(() => {
    if (!folderKey) return;
    setFolderDocsLoading(true);
    const qs = new URLSearchParams({ folderKey, view: "documents", limit: "100" });
    fetch(`/api/records/casefolders/${id}?${qs}`)
      .then((r) => r.json())
      .then((d) => setFolderDocs((d.documents ?? []).map((doc: { id: string; title: string; referenceNumber: string; status: string; metadata?: Record<string, unknown> }) => ({
        id: doc.id,
        title: doc.title,
        referenceNumber: doc.referenceNumber,
        status: doc.status,
        metadata: doc.metadata ?? {},
      })))
      )
      .catch(() => {})
      .finally(() => setFolderDocsLoading(false));
  }, [id, folderKey]);

  /* ---- Parsed fields ---- */
  const fields = useMemo(
    () => (data ? parseCasefolderFields(data.casefolder.fields) : []),
    [data]
  );

  /* ---- Edit mode helpers ---- */
  const enterEditMode = useCallback(() => {
    if (!data) return;
    const vals: Record<string, string> = {};
    for (const field of parseCasefolderFields(data.casefolder.fields)) {
      const raw = data.fieldValues[field.name];
      vals[field.name] = raw !== null && raw !== undefined ? String(raw) : "";
    }
    setEditValues(vals);
    setSaveError(null);
    setSaveSuccess(false);
    setEditMode(true);
  }, [data]);

  const cancelEditMode = useCallback(() => {
    setEditMode(false);
    setEditValues({});
    setSaveError(null);
  }, []);

  const handleEditChange = useCallback((fieldName: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!data) return;
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(false);

      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(editValues)) {
        payload[key] = value === "" ? null : value;
      }

      const res = await fetch(`/api/records/casefolders/${id}/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: payload }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save (${res.status})`);
      }

      // Refresh data
      await fetchDocument();
      setEditMode(false);
      setEditValues({});
      setSaveSuccess(true);
      // Auto-hide success after 3s
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }, [data, editValues, id, docId, fetchDocument]);

  /* ---- Loading ---- */
  if (loading) return <LoadingSkeleton />;

  /* ---- Error ---- */
  if (error || !data) {
    return (
      <ErrorState
        message={error || "Document not found"}
        onRetry={fetchDocument}
        casefolderId={id}
      />
    );
  }

  const { document: doc, casefolder, fieldValues } = data;
  const createdByName = doc.createdBy.displayName || doc.createdBy.name || "Unknown";
  const perms = doc.effectivePermissions ?? VIEW_ONLY_PERMISSIONS;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-4rem)]">
      {/* ============================================================ */}
      {/*  Mobile-only tab switcher: Viewer ↔ Details                  */}
      {/*  Hidden on lg+ where both panels render side-by-side         */}
      {/* ============================================================ */}
      <div className="lg:hidden sticky top-0 z-10 flex items-stretch border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        {(
          [
            {
              key: "viewer" as const,
              label: "Document",
              icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              ),
            },
            {
              key: "details" as const,
              label: "Details",
              icon: (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                </svg>
              ),
            },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setMobilePane(t.key)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              mobilePane === t.key
                ? "border-[#02773b] text-[#02773b]"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/*  LEFT PANEL — Metadata                                        */}
      {/*  Mobile: full width, only visible when "details" tab is active */}
      {/*  Desktop: fixed-width side column                             */}
      {/* ============================================================ */}
      <aside
        className={`w-full lg:w-[35%] lg:min-w-[340px] lg:max-w-[480px] border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col overflow-hidden lg:flex ${
          mobilePane === "details" ? "flex" : "hidden"
        }`}
      >
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ---- Back + casefolder badge ---- */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/records/casefolders/${id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-[#02773b]/10 hover:text-[#02773b] dark:hover:text-[#02773b] transition-colors"
            >
              <IconArrowLeft className="w-3.5 h-3.5" />
              Back to Folder
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400">
              <IconFolder className="w-3.5 h-3.5" />
              {casefolder.name}
            </span>
          </div>

          {/* ---- Document title ---- */}
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-snug">
              {doc.title}
            </h1>
            {doc.description && !doc.description.startsWith("Auto-captured from") && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                {doc.description}
              </p>
            )}
          </div>

          {/* ---- Save success toast ---- */}
          {saveSuccess && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
              <IconCheck className="w-4 h-4 shrink-0" />
              Metadata updated successfully.
            </div>
          )}

          {/* ---- File details ---- */}
          {fields.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#dd9f42] dark:text-[#dd9f42]">
                File Details
              </h2>
              <dl className="space-y-3">
                {fields.map((field) =>
                  editMode ? (
                    <MetadataFieldEdit
                      key={field.name}
                      field={field}
                      value={editValues[field.name] ?? ""}
                      onChange={(val) => handleEditChange(field.name, val)}
                    />
                  ) : (
                    <MetadataFieldDisplay
                      key={field.name}
                      field={field}
                      value={fieldValues[field.name]}
                    />
                  )
                )}
              </dl>

              {/* Edit mode save/cancel or save error */}
              {editMode && (
                <div className="space-y-2 pt-1">
                  {saveError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                      <IconExclamation className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {saveError}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
                    >
                      {saving ? (
                        <IconSpinner className="w-3.5 h-3.5" />
                      ) : (
                        <IconCheck className="w-3.5 h-3.5" />
                      )}
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      onClick={cancelEditMode}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                    >
                      <IconX className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ---- Divider ---- */}
          <div className="h-px bg-gray-200 dark:bg-gray-800" />

          {/* ---- Document info section ---- */}
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#dd9f42] dark:text-[#dd9f42]">
              Document Info
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* Reference # */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <IconHash className="w-3 h-3" />
                  Reference
                </div>
                <p className="text-sm font-mono text-gray-900 dark:text-gray-100">
                  {doc.referenceNumber}
                </p>
              </div>

              {/* Status */}
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Status
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${getStatusColor(doc.status)}`}
                >
                  {doc.status.replace(/_/g, " ")}
                </span>
              </div>

              {/* Department */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <IconBuilding className="w-3 h-3" />
                  Department
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {doc.department || <span className="text-gray-300 dark:text-gray-600">&mdash;</span>}
                </p>
              </div>

              {/* Filed by */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <IconUser className="w-3 h-3" />
                  Filed by
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {createdByName}
                </p>
              </div>

              {/* Date */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <IconClock className="w-3 h-3" />
                  Date Filed
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(doc.createdAt)}
                </p>
              </div>

              {/* File count */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <IconFile className="w-3 h-3" />
                  Files
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {doc.files.length} {doc.files.length === 1 ? "file" : "files"}
                </p>
              </div>
            </div>
          </section>

          {/* ---- Divider ---- */}
          <div className="h-px bg-gray-200 dark:bg-gray-800" />

          {/* ---- Actions ---- */}
          <section className="space-y-2">
            {!editMode && perms.canEdit && (
              <button
                onClick={enterEditMode}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 dark:text-emerald-400 dark:bg-[#02773b]/20 dark:hover:bg-[#02773b]/30 transition-colors"
              >
                <IconPencil className="w-4 h-4" />
                Edit Metadata
              </button>
            )}

            {doc.files.length > 0 && perms.canDownload && (
              <a
                href={downloadUrl(doc.files[0].storagePath)}
                download={doc.files[0].fileName}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-karu-green text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
              >
                <IconDownload className="w-4 h-4" />
                Download Primary File
              </a>
            )}

            {doc.files.length > 0 && perms.canPrint && (
              <button
                type="button"
                onClick={() => {
                  // Fire-and-forget audit; don't block the print dialog.
                  fetch(`/api/documents/${doc.id}/events`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "printed" }),
                  }).catch(() => {});
                  window.print();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-karu-green text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
              >
                <IconPrinter className="w-4 h-4" />
                Print
              </button>
            )}

            {perms.canShare && (
              <Link
                href={`/documents/${doc.id}?share=1`}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-karu-green text-karu-green hover:bg-karu-green-light dark:hover:bg-karu-green/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                </svg>
                Share
              </Link>
            )}

            <Link
              href={`/records/casefolders/${id}`}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 transition-colors"
            >
              <IconArrowLeft className="w-4 h-4" />
              Back to Casefolder
            </Link>
          </section>

          {/* ---- Divider ---- */}
          {folderKey && (
            <Fragment>
              <div className="h-px bg-gray-200 dark:bg-gray-800" />

              {/* ---- Casefolder documents navigation ---- */}
              <section className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#dd9f42] dark:text-[#dd9f42]">
                  In This Folder
                </h2>
                {folderDocsLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-4 h-4 border-2 border-[#02773b] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : folderDocs.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 py-2">No other documents in this folder.</p>
                ) : (
                  <ul className="space-y-1">
                    {folderDocs.map((sibling) => {
                      const isCurrent = sibling.id === docId;
                      const allFields = Array.isArray(data?.casefolder.fields) ? data.casefolder.fields as unknown[] : [];
                      const label = getDocLabel(sibling.metadata, allFields, sibling.referenceNumber);
                      return (
                        <li key={sibling.id}>
                          <button
                            onClick={() => !isCurrent && router.push(`/records/casefolders/${id}/${sibling.id}?folderKey=${encodeURIComponent(folderKey)}`)}
                            disabled={isCurrent}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                              isCurrent
                                ? "bg-[#02773b]/10 dark:bg-[#02773b]/20 border border-[#02773b]/20 dark:border-[#02773b]/30 cursor-default"
                                : "hover:bg-gray-50 dark:hover:bg-gray-900 border border-transparent cursor-pointer"
                            }`}
                          >
                            <span className={isCurrent ? "text-[#02773b] dark:text-emerald-400" : "text-gray-400 dark:text-gray-500"}>
                              <IconDocument className="w-4 h-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-[10px] font-mono truncate ${isCurrent ? "text-[#02773b] dark:text-emerald-400" : "text-[#dd9f42]"}`}>
                                {sibling.referenceNumber}
                              </p>
                              <p className={`text-sm font-medium truncate ${isCurrent ? "text-[#02773b] dark:text-emerald-400" : "text-gray-900 dark:text-gray-100"}`}>
                                {label}
                              </p>
                            </div>
                            {isCurrent && (
                              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#02773b]" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </Fragment>
          )}

          {/* ---- Attached files (shown only when no folder nav) ---- */}
          {!folderKey && doc.files.length > 0 && (
            <Fragment>
              <div className="h-px bg-gray-200 dark:bg-gray-800" />
              <section className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#dd9f42] dark:text-[#dd9f42]">
                  Attached Files
                </h2>
                <ul className="space-y-1.5">
                  {doc.files.map((file, index) => {
                    const allFields = Array.isArray(data?.casefolder.fields) ? data.casefolder.fields as unknown[] : [];
                    const displayLabel = getDocLabel(doc.metadata ?? {}, allFields, file.fileName);
                    const showFilename = displayLabel !== file.fileName;
                    return (
                      <li key={file.id}>
                        <button
                          onClick={() => setSelectedFileIndex(index)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                            index === selectedFileIndex
                              ? "bg-[#02773b]/10 dark:bg-[#02773b]/20 border border-[#02773b]/20 dark:border-[#02773b]/30"
                              : "hover:bg-gray-50 dark:hover:bg-gray-900 border border-transparent"
                          }`}
                        >
                          <span className={index === selectedFileIndex ? "text-[#02773b] dark:text-emerald-400" : "text-gray-400 dark:text-gray-500"}>
                            {getFileIcon(file.mimeType)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium truncate ${index === selectedFileIndex ? "text-[#02773b] dark:text-emerald-400" : "text-gray-900 dark:text-gray-100"}`}>
                              {displayLabel}
                            </p>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                              {showFilename && <span className="opacity-60">{file.fileName} &middot; </span>}
                              {formatBytes(file.sizeBytes)} &middot; {formatDate(file.uploadedAt)}
                            </p>
                          </div>
                          {perms.canDownload && (
                            <a
                              href={downloadUrl(file.storagePath)}
                              download={file.fileName}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-[#02773b] hover:bg-[#02773b]/10 dark:hover:text-emerald-400 dark:hover:bg-[#02773b]/20 transition-colors"
                              title={`Download ${file.fileName}`}
                            >
                              <IconDownload className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </Fragment>
          )}

          {/* ---- Version history ---- */}
          {doc.versions.length > 0 && (
            <Fragment>
              <div className="h-px bg-gray-200 dark:bg-gray-800" />
              <VersionHistory versions={doc.versions} />
            </Fragment>
          )}

          {/* ---- Last updated ---- */}
          {doc.updatedAt && doc.updatedAt !== doc.createdAt && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">
              Last updated {formatDateTime(doc.updatedAt)}
            </p>
          )}
        </div>
      </aside>

      {/* ============================================================ */}
      {/*  RIGHT PANEL — Document Viewer                                */}
      {/*  Mobile: visible only when "viewer" tab is active             */}
      {/* ============================================================ */}
      <main
        className={`flex-1 flex-col min-h-0 bg-gray-50 dark:bg-gray-900 lg:flex h-[calc(100vh-8rem)] lg:h-auto ${
          mobilePane === "viewer" ? "flex" : "hidden"
        }`}
      >
        <DocumentViewer
          files={doc.files}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={setSelectedFileIndex}
          perms={perms}
        />
      </main>
    </div>
  );
}
