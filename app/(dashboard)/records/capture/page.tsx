"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Can } from "@/components/auth/can";

/* ================================================================
   Types
   ================================================================ */

interface CaptureProfile {
  id: string;
  name: string;
  description: string | null;
  folderPath: string;
  processedPath: string | null;
  errorPath: string | null;
  fileTypes: string[];
  pollingInterval: number;
  isActive: boolean;
  formTemplateId: string | null;
  department: string | null;
  metadataMapping: Record<string, string> | null;
  duplicateAction: "SKIP" | "VERSION" | "FLAG";
  lastScanAt: string | null;
  _count: { logs: number };
}

interface FormTemplate {
  id: string;
  name: string;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

/* ================================================================
   Constants
   ================================================================ */

const FILE_TYPE_OPTIONS = ["pdf", "xml", "docx", "xlsx", "jpg", "png", "tiff"];

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  xlsx: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  jpg: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  png: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
  tiff: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
};

const DUPLICATE_OPTIONS: { value: "SKIP" | "VERSION" | "FLAG"; label: string; desc: string }[] = [
  { value: "SKIP", label: "Skip", desc: "Ignore duplicates silently" },
  { value: "VERSION", label: "Create Version", desc: "Add as new document version" },
  { value: "FLAG", label: "Flag for Review", desc: "Mark for manual review" },
];

/* ================================================================
   Icons (inline SVGs)
   ================================================================ */

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconX({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconEdit({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconScan({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0 1 18 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 0 0 6 20.25h1.5M12 9v6m3-3H9" />
    </svg>
  );
}

function IconFolder({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function IconLog({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function IconClock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function IconAlert({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconChevronDown({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconBolt({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
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

function IconSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function IconWarning({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconEmpty({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

/* ================================================================
   Helpers
   ================================================================ */

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

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ================================================================
   Sub-components
   ================================================================ */

/* ---------- Toast container ---------- */

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 pl-4 pr-3 py-3 rounded-2xl shadow-lg text-sm font-medium animate-slide-up ${
            t.type === "success"
              ? "bg-emerald-600 text-white"
              : t.type === "error"
              ? "bg-red-600 text-white"
              : "bg-[#dd9f42] text-white"
          }`}
        >
          {t.type === "success" && <IconCheck className="w-4 h-4 flex-shrink-0" />}
          {t.type === "error" && <IconAlert className="w-4 h-4 flex-shrink-0" />}
          {t.type === "info" && <IconScan className="w-4 h-4 flex-shrink-0" />}
          <span>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors">
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Modal shell ---------- */

function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:pl-[272px]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${
          wide ? "max-w-3xl" : "max-w-lg"
        } max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl animate-scale-in overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <IconX />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Form field ---------- */

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </label>
  );
}

const inputClass =
  "w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none";

const monoInputClass =
  "w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none";

const textareaClass =
  "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none";

/* ---------- Searchable casefolder dropdown ---------- */

function CasefolderSelect({
  forms,
  value,
  onChange,
}: {
  forms: FormTemplate[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return forms;
    const q = query.toLowerCase();
    return forms.filter((f) => f.name.toLowerCase().includes(q));
  }, [forms, query]);

  const selected = forms.find((f) => f.id === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`${inputClass} flex items-center justify-between text-left`}
      >
        <span className={selected ? "" : "text-gray-400 dark:text-gray-500"}>
          {selected ? selected.name : "Select casefolder..."}
        </span>
        <IconChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden animate-scale-in">
          <div className="p-2 border-b border-gray-100 dark:border-gray-800">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search casefolders..."
                className="w-full h-8 pl-8 pr-3 rounded-lg border-0 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              None
            </button>
            {filtered.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onChange(f.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  f.id === value
                    ? "text-[#02773b] font-medium bg-[#02773b]/5"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                {f.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-gray-400 text-center">No casefolders found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Main component
   ================================================================ */

export default function CaptureProfilesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "loading") return;
    const p = session?.user?.permissions ?? [];
    if (!p.includes("admin:manage") && !p.includes("records_capture:read")) router.replace("/records/casefolders");
  }, [session, status, router]);
  /* -------- data state -------- */
  const [profiles, setProfiles] = useState<CaptureProfile[]>([]);
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* -------- toast state -------- */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  function addToast(message: string, type: Toast["type"] = "success") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  /* -------- modal state -------- */
  const [showModal, setShowModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CaptureProfile | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<CaptureProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* -------- form fields -------- */
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fFolderPath, setFFolderPath] = useState("");
  const [fProcessedPath, setFProcessedPath] = useState("");
  const [fErrorPath, setFErrorPath] = useState("");
  const [fFileTypes, setFFileTypes] = useState<string[]>(["pdf"]);
  const [fPollingInterval, setFPollingInterval] = useState(60);
  const [fFormTemplateId, setFFormTemplateId] = useState("");
  const [fDepartment, setFDepartment] = useState("");
  // Filename pattern removed — metadata comes from XML buddy files
  const [fDuplicateAction, setFDuplicateAction] = useState<"SKIP" | "VERSION" | "FLAG">("SKIP");

  /* -------- scan state -------- */
  const [scanningAll, setScanningAll] = useState(false);
  const [scanningProfileId, setScanningProfileId] = useState<string | null>(null);

  /* ================================================================
     Data fetching
     ================================================================ */

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/capture/profiles");
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to fetch capture profiles");
      }
      const data = await res.json();
      setProfiles(data.profiles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchForms = useCallback(async () => {
    try {
      const res = await fetch("/api/forms?active=true");
      if (!res.ok) return;
      const data = await res.json();
      setForms(data.templates ?? data.forms ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
    fetchForms();
  }, [fetchProfiles, fetchForms]);

  /* ================================================================
     Actions
     ================================================================ */

  /* -- Toggle active -- */
  async function toggleActive(profile: CaptureProfile) {
    try {
      const res = await fetch(`/api/capture/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !profile.isActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to update profile");
      }
      addToast(`Profile "${profile.name}" ${profile.isActive ? "deactivated" : "activated"}`);
      fetchProfiles();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to toggle", "error");
    }
  }

  /* -- Scan all -- */
  async function handleScanAll() {
    setScanningAll(true);
    try {
      const res = await fetch("/api/capture/scan", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Scan failed");
      }
      const data = await res.json();
      const total = data.totalCaptured ?? data.captured ?? 0;
      const errors = data.totalErrors ?? data.errors ?? 0;
      addToast(
        `Scan complete -- ${total} file${total === 1 ? "" : "s"} captured${errors > 0 ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}`,
        errors > 0 ? "info" : "success",
      );
      fetchProfiles();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Scan failed", "error");
    } finally {
      setScanningAll(false);
    }
  }

  /* -- Scan single profile -- */
  async function handleScanProfile(profileId: string) {
    setScanningProfileId(profileId);
    try {
      const res = await fetch(`/api/capture/scan/${profileId}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Scan failed");
      }
      const data = await res.json();
      const captured = data.captured ?? 0;
      const errors = data.errors ?? 0;
      addToast(
        `Scan complete -- ${captured} file${captured === 1 ? "" : "s"} captured${errors > 0 ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}`,
        errors > 0 ? "info" : "success",
      );
      fetchProfiles();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Scan failed", "error");
    } finally {
      setScanningProfileId(null);
    }
  }

  /* -- Open create -- */
  function openCreate() {
    setEditingProfile(null);
    setFName("");
    setFDescription("");
    setFFolderPath("");
    setFProcessedPath("");
    setFErrorPath("");
    setFFileTypes(["pdf"]);
    setFPollingInterval(60);
    setFFormTemplateId("");
    setFDepartment("");
    setFDuplicateAction("SKIP");
    setShowModal(true);
  }

  /* -- Open edit -- */
  function openEdit(profile: CaptureProfile) {
    setEditingProfile(profile);
    setFName(profile.name);
    setFDescription(profile.description ?? "");
    setFFolderPath(profile.folderPath);
    setFProcessedPath(profile.processedPath ?? "");
    setFErrorPath(profile.errorPath ?? "");
    setFFileTypes(profile.fileTypes.length > 0 ? profile.fileTypes : ["pdf"]);
    setFPollingInterval(profile.pollingInterval);
    setFFormTemplateId(profile.formTemplateId ?? "");
    setFDepartment(profile.department ?? "");
    // metadataMapping no longer used — XML buddy files provide metadata
    setFDuplicateAction(profile.duplicateAction);
    setShowModal(true);
  }

  /* -- Save create/edit -- */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: fName,
        description: fDescription || undefined,
        folderPath: fFolderPath,
        processedPath: fProcessedPath || undefined,
        errorPath: fErrorPath || undefined,
        fileTypes: fFileTypes,
        pollingInterval: fPollingInterval,
        formTemplateId: fFormTemplateId || undefined,
        department: fDepartment || undefined,
        metadataMapping: {},
        duplicateAction: fDuplicateAction,
      };

      const isEdit = !!editingProfile;
      const url = isEdit ? `/api/capture/profiles/${editingProfile!.id}` : "/api/capture/profiles";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Failed to ${isEdit ? "update" : "create"} profile`);
      }
      addToast(`Profile "${fName}" ${isEdit ? "updated" : "created"} successfully`);
      setShowModal(false);
      fetchProfiles();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  /* -- Delete -- */
  function openDelete(profile: CaptureProfile) {
    setDeletingProfile(profile);
    setShowDeleteModal(true);
  }

  async function handleDelete() {
    if (!deletingProfile) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/capture/profiles/${deletingProfile.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to delete profile");
      }
      addToast(`Profile "${deletingProfile.name}" deleted`);
      setShowDeleteModal(false);
      setDeletingProfile(null);
      fetchProfiles();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setDeleting(false);
    }
  }

  /* -- File type toggle -- */
  function toggleFileType(ft: string) {
    setFFileTypes((prev) =>
      prev.includes(ft) ? prev.filter((x) => x !== ft) : [...prev, ft],
    );
  }

  /* ================================================================
     Derived stats
     ================================================================ */

  const totalProfiles = profiles.length;
  const activeProfiles = profiles.filter((p) => p.isActive).length;
  const totalLogs = profiles.reduce((sum, p) => sum + (p._count?.logs ?? 0), 0);
  /* We show total log count as "Files Captured" and 0 for errors since we can't distinguish from this data */

  /* ================================================================
     Helpers for rendering
     ================================================================ */

  function getFormName(formId: string | null): string | null {
    if (!formId) return null;
    const form = forms.find((f) => f.id === formId);
    return form ? form.name : null;
  }

  /* ================================================================
     Render
     ================================================================ */

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* Toast */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* -------- Header -------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Auto Capture</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure automated document capture from watched folders
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Can anyOf={["records:manage", "admin:manage"]}>
            <button
              onClick={handleScanAll}
              disabled={scanningAll}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#dd9f42] text-white font-medium text-sm transition-all hover:bg-[#c98d35] focus:ring-2 focus:ring-[#dd9f42]/30 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {scanningAll ? <IconSpinner className="w-4 h-4" /> : <IconBolt className="w-4 h-4" />}
              {scanningAll ? "Scanning..." : "Scan All Now"}
            </button>
          </Can>
          <Can anyOf={["records:create", "records:manage"]}>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 whitespace-nowrap"
            >
              <IconPlus />
              New Capture Profile
            </button>
          </Can>
        </div>
      </div>

      {/* -------- Stats cards -------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up delay-100">
        {/* Total Profiles */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#02773b]/10 dark:bg-[#02773b]/20">
              <IconFolder className="w-5 h-5 text-[#02773b]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? "--" : totalProfiles}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Profiles</p>
            </div>
          </div>
        </div>

        {/* Active */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
              <IconBolt className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? "--" : activeProfiles}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Active</p>
            </div>
          </div>
        </div>

        {/* Files Captured */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/30">
              <IconDocument className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? "--" : totalLogs}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Files Captured</p>
            </div>
          </div>
        </div>

        {/* Errors */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30">
              <IconAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? "--" : 0}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Errors (today)</p>
            </div>
          </div>
        </div>
      </div>

      {/* -------- Error banner -------- */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-sm">
          <IconAlert className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* -------- Loading skeleton -------- */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 animate-pulse"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                  <div className="h-3.5 w-60 bg-gray-100 dark:bg-gray-800 rounded" />
                </div>
                <div className="h-6 w-14 bg-gray-200 dark:bg-gray-700 rounded-full" />
              </div>
              <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded mb-3" />
              <div className="flex gap-2 mb-4">
                <div className="h-5 w-12 bg-gray-100 dark:bg-gray-800 rounded-full" />
                <div className="h-5 w-14 bg-gray-100 dark:bg-gray-800 rounded-full" />
                <div className="h-5 w-10 bg-gray-100 dark:bg-gray-800 rounded-full" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 w-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                <div className="h-8 w-20 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                <div className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------- Empty state -------- */}
      {!isLoading && !error && profiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-slide-up">
          <IconEmpty className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            No capture profiles yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
            Create a capture profile to automatically ingest documents from watched folders.
          </p>
          <Can anyOf={["records:create", "records:manage"]}>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark"
            >
              <IconPlus />
              New Capture Profile
            </button>
          </Can>
        </div>
      )}

      {/* -------- Profile cards -------- */}
      {!isLoading && profiles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-slide-up delay-200">
          {profiles.map((profile) => {
            const formName = getFormName(profile.formTemplateId);
            const isScanningThis = scanningProfileId === profile.id;

            return (
              <div
                key={profile.id}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 transition-shadow hover:shadow-md"
              >
                {/* Top row: name + toggle */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-4">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {profile.name}
                    </h3>
                    {profile.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                        {profile.description}
                      </p>
                    )}
                  </div>
                  {/* Active toggle */}
                  <Can anyOf={["records:update", "records:manage"]}>
                    <button
                      onClick={() => toggleActive(profile)}
                      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
                        profile.isActive
                          ? "bg-emerald-500"
                          : "bg-gray-300 dark:bg-gray-600"
                      }`}
                      title={profile.isActive ? "Active -- click to deactivate" : "Inactive -- click to activate"}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          profile.isActive ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </Can>
                </div>

                {/* Folder path */}
                <div className="flex items-center gap-2 mb-3">
                  <IconFolder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <code className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">
                    {profile.folderPath}
                  </code>
                </div>

                {/* File type badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {profile.fileTypes.map((ft) => (
                    <span
                      key={ft}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        FILE_TYPE_COLORS[ft] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      .{ft}
                    </span>
                  ))}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400 mb-4">
                  {formName && (
                    <span className="flex items-center gap-1">
                      <IconDocument className="w-3.5 h-3.5" />
                      {formName}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <IconClock className="w-3.5 h-3.5" />
                    Every {formatInterval(profile.pollingInterval)}
                  </span>
                  <span className="flex items-center gap-1">
                    Duplicates: {profile.duplicateAction === "SKIP" ? "Skip" : profile.duplicateAction === "VERSION" ? "Version" : "Flag"}
                  </span>
                  {profile.lastScanAt && (
                    <span className="flex items-center gap-1">
                      Last scan: {timeAgo(profile.lastScanAt)}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <IconLog className="w-3.5 h-3.5" />
                    {profile._count?.logs ?? 0} log{(profile._count?.logs ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <Can anyOf={["records:update", "records:manage"]}>
                    <button
                      onClick={() => openEdit(profile)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <IconEdit className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </Can>
                  <Can anyOf={["records:manage", "admin:manage"]}>
                    <button
                      onClick={() => handleScanProfile(profile.id)}
                      disabled={isScanningThis || scanningAll}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-[#dd9f42] bg-[#dd9f42]/10 hover:bg-[#dd9f42]/20 dark:bg-[#dd9f42]/10 dark:hover:bg-[#dd9f42]/20 transition-colors disabled:opacity-50"
                    >
                      {isScanningThis ? (
                        <IconSpinner className="w-3.5 h-3.5" />
                      ) : (
                        <IconScan className="w-3.5 h-3.5" />
                      )}
                      {isScanningThis ? "Scanning..." : "Scan Now"}
                    </button>
                  </Can>
                  <a
                    href={`/records/capture/activity?profile=${profile.id}`}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                  >
                    <IconLog className="w-3.5 h-3.5" />
                    View Logs
                  </a>
                  <Can anyOf={["records:delete", "records:manage"]}>
                    <button
                      onClick={() => openDelete(profile)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors ml-auto"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </Can>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================
         Create / Edit Modal
         ================================================================ */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingProfile ? "Edit Capture Profile" : "New Capture Profile"}
        wide
      >
        <form onSubmit={handleSave} className="space-y-5">
          {/* Row 1: Name + Department */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required>
              <input
                type="text"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                required
                placeholder="e.g. Student Transcripts"
                className={inputClass}
              />
            </Field>
            <Field label="Department">
              <input
                type="text"
                value={fDepartment}
                onChange={(e) => setFDepartment(e.target.value)}
                placeholder="e.g. Registrar"
                className={inputClass}
              />
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={fDescription}
              onChange={(e) => setFDescription(e.target.value)}
              placeholder="Brief description of what this profile captures..."
              rows={2}
              className={textareaClass}
            />
          </Field>

          {/* Folder Path */}
          <Field label="Folder Path" required hint="Absolute path to the folder to watch for incoming documents">
            <input
              type="text"
              value={fFolderPath}
              onChange={(e) => setFFolderPath(e.target.value)}
              required
              placeholder="/mnt/scans/incoming"
              className={monoInputClass}
            />
          </Field>

          {/* Row: Processed + Error paths */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Processed Folder Path" hint="Move files here after successful capture">
              <input
                type="text"
                value={fProcessedPath}
                onChange={(e) => setFProcessedPath(e.target.value)}
                placeholder="/mnt/scans/processed"
                className={monoInputClass}
              />
            </Field>
            <Field label="Error Folder Path" hint="Move files here on capture failure">
              <input
                type="text"
                value={fErrorPath}
                onChange={(e) => setFErrorPath(e.target.value)}
                placeholder="/mnt/scans/errors"
                className={monoInputClass}
              />
            </Field>
          </div>

          {/* File Types */}
          <Field label="File Types">
            <div className="flex flex-wrap gap-2 mt-1">
              {FILE_TYPE_OPTIONS.map((ft) => {
                const isSelected = fFileTypes.includes(ft);
                return (
                  <button
                    key={ft}
                    type="button"
                    onClick={() => toggleFileType(ft)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      isSelected
                        ? "border-[#02773b] bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 dark:border-emerald-600 dark:bg-emerald-950/30"
                        : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    {isSelected && <IconCheck className="w-3 h-3" />}
                    .{ft}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Row: Polling Interval + Target Casefolder */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Polling Interval" hint="How often to check for new files (in seconds)">
              <input
                type="number"
                value={fPollingInterval}
                onChange={(e) => setFPollingInterval(Math.max(5, parseInt(e.target.value) || 60))}
                min={5}
                className={inputClass}
              />
            </Field>
            <Field label="Target Casefolder">
              <CasefolderSelect forms={forms} value={fFormTemplateId} onChange={setFFormTemplateId} />
            </Field>
          </div>

          {/* Metadata Source Info */}
          <div className="p-3 rounded-xl bg-[#02773b]/5 dark:bg-[#02773b]/10 border border-[#02773b]/20">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-[#02773b] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-[#02773b] dark:text-emerald-400">
                  Metadata is auto-extracted from XML sidecar files
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  When scanners output a PDF with a matching XML file (e.g., <code className="font-mono">document.pdf</code> + <code className="font-mono">document.xml</code>), the system automatically reads Student Name, Registration Number, Department, School, and other fields from the XML. No manual pattern configuration needed.
                </p>
              </div>
            </div>
          </div>

          {/* Duplicate Action */}
          <Field label="Duplicate Action">
            <div className="space-y-2 mt-1">
              {DUPLICATE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    fDuplicateAction === opt.value
                      ? "border-[#02773b] bg-[#02773b]/5 dark:border-emerald-600 dark:bg-emerald-950/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="duplicateAction"
                    value={opt.value}
                    checked={fDuplicateAction === opt.value}
                    onChange={() => setFDuplicateAction(opt.value)}
                    className="sr-only"
                  />
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      fDuplicateAction === opt.value
                        ? "border-[#02773b] dark:border-emerald-400"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {fDuplicateAction === opt.value && (
                      <div className="w-2 h-2 rounded-full bg-[#02773b] dark:bg-emerald-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="h-10 px-5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !fName.trim() || !fFolderPath.trim()}
              className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving && <IconSpinner className="w-4 h-4" />}
              {editingProfile ? "Save Changes" : "Create Profile"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ================================================================
         Delete Confirmation Modal
         ================================================================ */}
      <Modal
        open={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeletingProfile(null);
        }}
        title="Delete Capture Profile"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30 flex-shrink-0">
              <IconWarning className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Are you sure you want to delete the capture profile{" "}
                <strong className="text-gray-900 dark:text-gray-100">
                  &ldquo;{deletingProfile?.name}&rdquo;
                </strong>
                ?
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                This will stop all automated scanning for this profile. Existing captured documents will not be
                affected. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={() => {
                setShowDeleteModal(false);
                setDeletingProfile(null);
              }}
              className="h-10 px-5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-red-600 text-white font-medium text-sm transition-all hover:bg-red-700 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting && <IconSpinner className="w-4 h-4" />}
              Delete Profile
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
