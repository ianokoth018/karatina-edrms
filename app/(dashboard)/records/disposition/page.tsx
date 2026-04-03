"use client";

import { useState, useEffect, useCallback } from "react";

/* ---------- types ---------- */

interface ClassificationNode {
  code: string;
  title: string;
}

interface DispositionDocument {
  id: string;
  referenceNumber: string;
  title: string;
  department: string;
  status: string;
  retentionExpiresAt: string;
  isOnLegalHold: boolean;
  classificationNode: ClassificationNode | null;
  recommendedAction: "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW";
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type TabKey = "ALL" | "REVIEW" | "DESTROY" | "ARCHIVE_PERMANENT";

type ActionType = "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW";

/* ---------- constants ---------- */

const TABS: { key: TabKey; label: string }[] = [
  { key: "ALL", label: "All Due" },
  { key: "REVIEW", label: "Pending Review" },
  { key: "DESTROY", label: "For Destruction" },
  { key: "ARCHIVE_PERMANENT", label: "For Archive" },
];

const ACTION_BADGE: Record<ActionType, { bg: string; text: string; label: string }> = {
  DESTROY: {
    bg: "bg-red-100 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-400",
    label: "Destroy",
  },
  ARCHIVE_PERMANENT: {
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-400",
    label: "Archive",
  },
  REVIEW: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-400",
    label: "Review",
  },
};

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------- icons (inline SVGs) ---------- */

function LockIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function ScanIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5M20.25 16.5V18A2.25 2.25 0 0 1 18 20.25h-1.5M3.75 16.5V18A2.25 2.25 0 0 0 6 20.25h1.5M12 9v6m3-3H9" />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function ArchiveIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
  );
}

function ClipboardIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  );
}

function XIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function AlertTriangleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

/* ---------- toast component ---------- */

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

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
          {t.type === "success" && <CheckIcon className="w-4 h-4 flex-shrink-0" />}
          {t.type === "error" && <AlertTriangleIcon className="w-4 h-4 flex-shrink-0" />}
          {t.type === "info" && <ScanIcon className="w-4 h-4 flex-shrink-0" />}
          <span>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- main component ---------- */

export default function DispositionPage() {
  /* data state */
  const [documents, setDocuments] = useState<DispositionDocument[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* filters / tabs */
  const [activeTab, setActiveTab] = useState<TabKey>("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("");

  /* selection */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<ActionType>("DESTROY");
  const [modalNotes, setModalNotes] = useState("");
  const [modalProcessing, setModalProcessing] = useState(false);
  const [modalResult, setModalResult] = useState<{ processed: number; skipped: number; skippedIds: string[] } | null>(null);

  /* scan */
  const [scanning, setScanning] = useState(false);

  /* toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = { current: 0 };

  function addToast(message: string, type: Toast["type"] = "success") {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  /* ---------- fetch ---------- */

  const statusForTab = (tab: TabKey): string => {
    if (tab === "ALL") return "";
    if (tab === "REVIEW") return "PENDING_REVIEW";
    if (tab === "DESTROY") return "PENDING_DISPOSAL";
    if (tab === "ARCHIVE_PERMANENT") return "PENDING_ARCHIVE";
    return "";
  };

  const fetchDocuments = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");
        const s = statusForTab(activeTab);
        if (s) params.set("status", s);
        if (departmentFilter) params.set("department", departmentFilter);

        const res = await fetch(`/api/records/disposition?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch disposition records");
        }
        const data = await res.json();
        setDocuments(data.documents ?? []);
        setPagination(data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    },
    [activeTab, departmentFilter],
  );

  useEffect(() => {
    fetchDocuments(1);
    setSelectedIds(new Set());
  }, [fetchDocuments]);

  /* ---------- scan ---------- */

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/records/disposition/scan", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Scan failed");
      }
      const data = await res.json();
      addToast(`Retention scan complete \u2014 ${data.flagged} document${data.flagged === 1 ? "" : "s"} flagged`, "info");
      fetchDocuments(1);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  }

  /* ---------- selection ---------- */

  const selectableDocuments = documents.filter((d) => !d.isOnLegalHold);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === selectableDocuments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableDocuments.map((d) => d.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const allSelectableChecked = selectableDocuments.length > 0 && selectedIds.size === selectableDocuments.length;

  /* ---------- bulk action ---------- */

  function openActionModal(action: ActionType) {
    setModalAction(action);
    setModalNotes("");
    setModalResult(null);
    setModalOpen(true);
  }

  async function executeAction() {
    setModalProcessing(true);
    try {
      const res = await fetch("/api/records/disposition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: Array.from(selectedIds),
          action: modalAction,
          notes: modalNotes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Action failed");
      }
      const data = await res.json();
      setModalResult(data);
      addToast(
        `${data.processed} document${data.processed === 1 ? "" : "s"} processed successfully${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}`,
        "success",
      );
      setSelectedIds(new Set());
      fetchDocuments(pagination.page);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setModalProcessing(false);
    }
  }

  /* ---------- stats ---------- */

  const totalDue = pagination.total;
  const pendingReview = documents.filter((d) => d.recommendedAction === "REVIEW").length;
  const forDestruction = documents.filter((d) => d.recommendedAction === "DESTROY").length;
  const forArchive = documents.filter((d) => d.recommendedAction === "ARCHIVE_PERMANENT").length;

  /* ---------- render ---------- */

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* Toast */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Records Disposition
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage document retention, disposal, and permanent archival
          </p>
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#dd9f42] text-white font-medium text-sm transition-all hover:bg-[#c98d35] focus:ring-2 focus:ring-[#dd9f42]/30 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <ScanIcon className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Run Retention Scan"}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#02773b]/10 dark:bg-[#02773b]/20">
              <ClipboardIcon className="w-5 h-5 text-[#02773b]" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Due</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{totalDue}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/30">
              <AlertTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pending Review</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pendingReview}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/30">
              <TrashIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">For Destruction</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{forDestruction}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/30">
              <ArchiveIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">For Archive</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{forArchive}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + department filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-white dark:bg-gray-700 text-[#02773b] dark:text-emerald-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Department</label>
          <input
            type="text"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            placeholder="e.g. ICT"
            className="h-9 w-36 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 transition-colors"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3 shadow-lg animate-slide-up">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {selectedIds.size} selected
          </span>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={() => openActionModal("DESTROY")}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Destroy
          </button>
          <button
            onClick={() => openActionModal("ARCHIVE_PERMANENT")}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            <ArchiveIcon className="w-3.5 h-3.5" />
            Archive
          </button>
          <button
            onClick={() => openActionModal("REVIEW")}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#dd9f42] text-white text-xs font-medium hover:bg-[#c98d35] transition-colors"
          >
            <ClipboardIcon className="w-3.5 h-3.5" />
            Review
          </button>
          <button
            onClick={clearSelection}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <XIcon className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelectableChecked}
                    onChange={toggleSelectAll}
                    disabled={selectableDocuments.length === 0}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/20 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Ref #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Title</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Department</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Classification</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Expired Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Recommended</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${40 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800">
                        <ArchiveIcon className="w-7 h-7 text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 font-medium">No records due for disposition</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-sm">
                        Run a retention scan to identify documents that have passed their retention period, or adjust your filters.
                      </p>
                      <button
                        onClick={handleScan}
                        disabled={scanning}
                        className="mt-2 inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#dd9f42] text-white text-xs font-medium hover:bg-[#c98d35] transition-colors disabled:opacity-60"
                      >
                        <ScanIcon className="w-3.5 h-3.5" />
                        Run Retention Scan
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => {
                  const badge = ACTION_BADGE[doc.recommendedAction];
                  const isSelected = selectedIds.has(doc.id);

                  return (
                    <tr
                      key={doc.id}
                      className={`transition-colors ${
                        doc.isOnLegalHold
                          ? "bg-amber-50/50 dark:bg-amber-950/10"
                          : isSelected
                          ? "bg-[#02773b]/5 dark:bg-[#02773b]/10"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <td className="px-4 py-3">
                        {doc.isOnLegalHold ? (
                          <div className="flex items-center justify-center" title="Legal hold - cannot be selected">
                            <LockIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                          </div>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(doc.id)}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/20 cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {doc.referenceNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[220px]">
                            {doc.title}
                          </span>
                          {doc.isOnLegalHold && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">
                              <LockIcon className="w-3 h-3" />
                              Legal Hold
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {doc.department}
                      </td>
                      <td className="px-4 py-3">
                        {doc.classificationNode ? (
                          <div>
                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                              {doc.classificationNode.code}
                            </span>
                            <span className="text-gray-400 dark:text-gray-500 mx-1">&middot;</span>
                            <span className="text-gray-700 dark:text-gray-300 text-xs">
                              {doc.classificationNode.title}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500 italic">Unclassified</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                        {formatDate(doc.retentionExpiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {doc.isOnLegalHold && (
                          <LockIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1}
              {" "}&ndash;{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}
              {" "}of {pagination.total} records
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchDocuments(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>

              {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.page <= 3) {
                  pageNum = i + 1;
                } else if (pagination.page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = pagination.page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => fetchDocuments(pageNum)}
                    className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                      pageNum === pagination.page
                        ? "bg-[#02773b] text-white"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => fetchDocuments(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
            onClick={() => {
              if (!modalProcessing) {
                setModalOpen(false);
                setModalResult(null);
              }
            }}
          />

          {/* Modal card */}
          <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-xl ${
                    modalAction === "DESTROY"
                      ? "bg-red-100 dark:bg-red-950/30"
                      : modalAction === "ARCHIVE_PERMANENT"
                      ? "bg-blue-100 dark:bg-blue-950/30"
                      : "bg-amber-100 dark:bg-amber-950/30"
                  }`}
                >
                  {modalAction === "DESTROY" && <TrashIcon className="w-5 h-5 text-red-600 dark:text-red-400" />}
                  {modalAction === "ARCHIVE_PERMANENT" && <ArchiveIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                  {modalAction === "REVIEW" && <ClipboardIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {modalAction === "DESTROY" && "Destroy Records"}
                    {modalAction === "ARCHIVE_PERMANENT" && "Archive Records"}
                    {modalAction === "REVIEW" && "Mark for Review"}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedIds.size} document{selectedIds.size === 1 ? "" : "s"} selected
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!modalProcessing) {
                    setModalOpen(false);
                    setModalResult(null);
                  }
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 pb-6 space-y-4">
              {/* Result display */}
              {modalResult ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4">
                    <div className="flex items-center gap-2">
                      <CheckIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        {modalResult.processed} document{modalResult.processed === 1 ? "" : "s"} processed successfully
                      </p>
                    </div>
                  </div>
                  {modalResult.skipped > 0 && (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                            {modalResult.skipped} document{modalResult.skipped === 1 ? "" : "s"} skipped
                          </p>
                          {modalResult.skippedIds.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                              IDs: {modalResult.skippedIds.join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setModalOpen(false);
                      setModalResult(null);
                    }}
                    className="w-full h-10 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#025e2f] transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {/* Warning for DESTROY */}
                  {modalAction === "DESTROY" && (
                    <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                            This action is irreversible
                          </p>
                          <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                            Destroyed records cannot be recovered. Ensure all documents have been reviewed and approved for destruction according to your retention policy.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notes field */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Notes <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={modalNotes}
                      onChange={(e) => setModalNotes(e.target.value)}
                      placeholder={
                        modalAction === "DESTROY"
                          ? "Reason for destruction and authorization reference..."
                          : modalAction === "ARCHIVE_PERMANENT"
                          ? "Archival notes and location details..."
                          : "Review notes and instructions..."
                      }
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 transition-colors resize-none"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        setModalOpen(false);
                        setModalResult(null);
                      }}
                      disabled={modalProcessing}
                      className="flex-1 h-10 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={executeAction}
                      disabled={modalProcessing || !modalNotes.trim()}
                      className={`flex-1 h-10 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        modalAction === "DESTROY"
                          ? "bg-red-600 hover:bg-red-700"
                          : modalAction === "ARCHIVE_PERMANENT"
                          ? "bg-blue-600 hover:bg-blue-700"
                          : "bg-[#dd9f42] hover:bg-[#c98d35]"
                      }`}
                    >
                      {modalProcessing ? (
                        <span className="inline-flex items-center gap-2">
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        <>
                          {modalAction === "DESTROY" && "Confirm Destruction"}
                          {modalAction === "ARCHIVE_PERMANENT" && "Confirm Archive"}
                          {modalAction === "REVIEW" && "Confirm Review"}
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
