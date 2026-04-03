"use client";

import { useState, useEffect, useCallback, Fragment } from "react";

/* ================================================================
   Types
   ================================================================ */

interface PhysicalRecord {
  id: string;
  referenceNumber: string;
  title: string;
  boxNumber: string | null;
  shelfLocation: string | null;
  offSiteLocation: string | null;
  barcode: string | null;
  status: string;
  checkedOutTo: string | null;
  checkedOutAt: string | null;
  expectedReturnAt: string | null;
  _count: { movements: number };
}

interface Movement {
  id: string;
  action: string;
  performedBy: { displayName: string; name: string } | null;
  notes: string | null;
  createdAt: string;
}

interface RecordDetail extends PhysicalRecord {
  movements: Movement[];
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ================================================================
   Constants
   ================================================================ */

const STATUSES = [
  "AVAILABLE",
  "CHECKED_OUT",
  "TRANSFERRED",
  "ARCHIVED",
  "DISPOSED",
] as const;

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  CHECKED_OUT:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  TRANSFERRED:
    "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  ARCHIVED:
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  DISPOSED:
    "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  CHECKED_OUT: "Checked Out",
  TRANSFERRED: "Transferred",
  ARCHIVED: "Archived",
  DISPOSED: "Disposed",
};

/* ================================================================
   Icons (inline SVG helpers)
   ================================================================ */

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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

function IconChevronLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
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

function IconCheckout({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  );
}

function IconCheckin({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
    </svg>
  );
}

function IconAlert({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function IconArchive({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
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

/* ================================================================
   Sub-components
   ================================================================ */

/* ---------- Modal shell ---------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* panel */}
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl animate-scale-in overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <IconX />
          </button>
        </div>
        {/* body */}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Form field ---------- */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none";

const textareaClass =
  "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none";

/* ================================================================
   Main component
   ================================================================ */

export default function PhysicalRecordsPage() {
  /* -------- list state -------- */
  const [records, setRecords] = useState<PhysicalRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* -------- filter state -------- */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  /* -------- modal state -------- */
  const [showCreateEdit, setShowCreateEdit] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PhysicalRecord | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutRecord, setCheckoutRecord] = useState<PhysicalRecord | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailRecord, setDetailRecord] = useState<RecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* -------- form state -------- */
  const [formTitle, setFormTitle] = useState("");
  const [formBox, setFormBox] = useState("");
  const [formShelf, setFormShelf] = useState("");
  const [formOffSite, setFormOffSite] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formDocumentId, setFormDocumentId] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  /* -------- checkout form state -------- */
  const [coExpectedReturn, setCoExpectedReturn] = useState("");
  const [coNotes, setCoNotes] = useState("");
  const [coSaving, setCoSaving] = useState(false);

  /* -------- expanded detail row -------- */
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<RecordDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  /* ================================================================
     Data fetching
     ================================================================ */

  const fetchRecords = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");
        if (search) params.set("search", search);
        if (statusFilter) params.set("status", statusFilter);

        const res = await fetch(`/api/records/physical?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch records");
        }
        const data = await res.json();
        setRecords(data.records ?? []);
        setPagination(data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    },
    [search, statusFilter]
  );

  useEffect(() => {
    fetchRecords(1);
  }, [fetchRecords]);

  async function fetchDetail(id: string): Promise<RecordDetail | null> {
    try {
      const res = await fetch(`/api/records/physical/${id}`);
      if (!res.ok) throw new Error("Failed to load detail");
      return await res.json();
    } catch {
      return null;
    }
  }

  /* ================================================================
     Actions
     ================================================================ */

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchRecords(1);
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
  }

  /* -- Create / Edit -- */

  function openCreate() {
    setEditingRecord(null);
    setFormTitle("");
    setFormBox("");
    setFormShelf("");
    setFormOffSite("");
    setFormBarcode("");
    setFormDocumentId("");
    setShowCreateEdit(true);
  }

  function openEdit(rec: PhysicalRecord) {
    setEditingRecord(rec);
    setFormTitle(rec.title);
    setFormBox(rec.boxNumber ?? "");
    setFormShelf(rec.shelfLocation ?? "");
    setFormOffSite(rec.offSiteLocation ?? "");
    setFormBarcode(rec.barcode ?? "");
    setFormDocumentId("");
    setShowCreateEdit(true);
  }

  async function handleSaveRecord(e: React.FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        title: formTitle,
        boxNumber: formBox || undefined,
        shelfLocation: formShelf || undefined,
        offSiteLocation: formOffSite || undefined,
        barcode: formBarcode || undefined,
        documentId: formDocumentId || undefined,
      };

      const isEdit = !!editingRecord;
      const url = isEdit
        ? `/api/records/physical/${editingRecord!.id}`
        : "/api/records/physical";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Failed to ${isEdit ? "update" : "create"} record`);
      }
      setShowCreateEdit(false);
      fetchRecords(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setFormSaving(false);
    }
  }

  /* -- Delete (dispose) -- */

  async function handleDispose(rec: PhysicalRecord) {
    if (!confirm(`Dispose record "${rec.title}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/records/physical/${rec.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to dispose record");
      }
      fetchRecords(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  /* -- Checkout / Checkin -- */

  function openCheckout(rec: PhysicalRecord) {
    setCheckoutRecord(rec);
    setCoExpectedReturn("");
    setCoNotes("");
    setShowCheckout(true);
  }

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!checkoutRecord) return;
    setCoSaving(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        expectedReturnAt: coExpectedReturn || undefined,
        notes: coNotes || undefined,
      };
      const res = await fetch(`/api/records/physical/${checkoutRecord.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to check out record");
      }
      setShowCheckout(false);
      fetchRecords(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setCoSaving(false);
    }
  }

  async function handleCheckin(rec: PhysicalRecord) {
    setError(null);
    try {
      const res = await fetch(`/api/records/physical/${rec.id}/checkout`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to check in record");
      }
      fetchRecords(pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  /* -- Detail modal -- */

  async function openDetail(id: string) {
    setShowDetail(true);
    setDetailLoading(true);
    setDetailRecord(null);
    const detail = await fetchDetail(id);
    setDetailRecord(detail);
    setDetailLoading(false);
  }

  /* -- Expandable row -- */

  async function toggleExpandRow(id: string) {
    if (expandedRowId === id) {
      setExpandedRowId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedRowId(id);
    setExpandedLoading(true);
    setExpandedDetail(null);
    const detail = await fetchDetail(id);
    setExpandedDetail(detail);
    setExpandedLoading(false);
  }

  /* ================================================================
     Derived stats
     ================================================================ */

  const totalCount = pagination.total;
  const availableCount = records.filter((r) => r.status === "AVAILABLE").length;
  const checkedOutCount = records.filter((r) => r.status === "CHECKED_OUT").length;
  const archivedCount = records.filter((r) => r.status === "ARCHIVED").length;

  const hasActiveFilters = statusFilter !== "";

  /* ================================================================
     Render
     ================================================================ */

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* -------- Header -------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Physical Records
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track, manage, and audit physical document storage
          </p>
        </div>

        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 whitespace-nowrap"
        >
          <IconPlus />
          New Record
        </button>
      </div>

      {/* -------- Stats row -------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up delay-100">
        {/* Total */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800">
              <IconArchive className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {isLoading ? "--" : totalCount}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Records</p>
            </div>
          </div>
        </div>

        {/* Available */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {isLoading ? "--" : availableCount}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Available</p>
            </div>
          </div>
        </div>

        {/* Checked Out */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30">
              <IconClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                {isLoading ? "--" : checkedOutCount}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Checked Out</p>
            </div>
          </div>
        </div>

        {/* Archived */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800">
              <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                {isLoading ? "--" : archivedCount}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Archived</p>
            </div>
          </div>
        </div>
      </div>

      {/* -------- Search + Filter -------- */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-4 animate-slide-up delay-200">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <IconSearch />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, reference number, or barcode..."
              className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>
          <button
            type="submit"
            className="h-10 px-4 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="h-9 px-3 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* -------- Error banner -------- */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconAlert className="h-4 w-4 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 rounded text-red-400 hover:text-red-600 transition-colors"
            >
              <IconX className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* -------- Table -------- */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-slide-up delay-300">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="w-8 px-2 py-3" />
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Ref #
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Title
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Box / Shelf
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Barcode
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${50 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <IconArchive className="w-12 h-12 text-gray-300 dark:text-gray-600" />
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No records found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {hasActiveFilters || search
                          ? "Try adjusting your search or filters"
                          : "Create your first physical record to get started"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <Fragment key={rec.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      {/* Expand toggle */}
                      <td className="px-2 py-3 text-center">
                        <button
                          onClick={() => toggleExpandRow(rec.id)}
                          className={`p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all ${
                            expandedRowId === rec.id ? "rotate-180" : ""
                          }`}
                          title="Toggle details"
                        >
                          <IconChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </td>

                      {/* Ref # */}
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {rec.referenceNumber}
                      </td>

                      {/* Title */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDetail(rec.id)}
                          className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-xs hover:text-karu-green dark:hover:text-karu-green transition-colors text-left"
                        >
                          {rec.title}
                        </button>
                        {rec.checkedOutTo && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                            Out to: {rec.checkedOutTo}
                          </p>
                        )}
                      </td>

                      {/* Box / Shelf */}
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                        <div>
                          {rec.boxNumber && (
                            <span>
                              Box {rec.boxNumber}
                            </span>
                          )}
                          {rec.boxNumber && rec.shelfLocation && (
                            <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
                          )}
                          {rec.shelfLocation && (
                            <span>{rec.shelfLocation}</span>
                          )}
                          {!rec.boxNumber && !rec.shelfLocation && (
                            <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
                          )}
                        </div>
                        {rec.offSiteLocation && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">
                            Off-site: {rec.offSiteLocation}
                          </span>
                        )}
                      </td>

                      {/* Barcode */}
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {rec.barcode ?? (
                          <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_BADGE[rec.status] ?? STATUS_BADGE.AVAILABLE
                          }`}
                        >
                          {STATUS_LABEL[rec.status] ?? rec.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Edit */}
                          {rec.status !== "DISPOSED" && (
                            <button
                              onClick={() => openEdit(rec)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              title="Edit"
                            >
                              <IconEdit />
                            </button>
                          )}

                          {/* Checkout / Checkin */}
                          {rec.status === "AVAILABLE" && (
                            <button
                              onClick={() => openCheckout(rec)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-karu-gold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              title="Check Out"
                            >
                              <IconCheckout />
                            </button>
                          )}
                          {rec.status === "CHECKED_OUT" && (
                            <button
                              onClick={() => handleCheckin(rec)}
                              className="p-1.5 rounded-lg text-amber-500 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              title="Check In"
                            >
                              <IconCheckin />
                            </button>
                          )}

                          {/* Dispose */}
                          {rec.status !== "DISPOSED" && rec.status !== "CHECKED_OUT" && (
                            <button
                              onClick={() => handleDispose(rec)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                              title="Dispose"
                            >
                              <IconTrash />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedRowId === rec.id && (
                      <tr className="bg-gray-50/50 dark:bg-gray-800/30">
                        <td colSpan={7} className="px-6 py-4">
                          {expandedLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                              <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-karu-green rounded-full animate-spin" />
                              Loading details...
                            </div>
                          ) : expandedDetail ? (
                            <div className="space-y-4">
                              {/* Metadata grid */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Box Number
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                    {expandedDetail.boxNumber || "--"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Shelf Location
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                    {expandedDetail.shelfLocation || "--"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Off-site Location
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                    {expandedDetail.offSiteLocation || "--"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Barcode
                                  </p>
                                  <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-0.5">
                                    {expandedDetail.barcode || "--"}
                                  </p>
                                </div>
                                {expandedDetail.checkedOutTo && (
                                  <>
                                    <div>
                                      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                        Checked Out To
                                      </p>
                                      <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
                                        {expandedDetail.checkedOutTo}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                        Checked Out At
                                      </p>
                                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                        {expandedDetail.checkedOutAt
                                          ? formatDateTime(expandedDetail.checkedOutAt)
                                          : "--"}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                        Expected Return
                                      </p>
                                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                        {expandedDetail.expectedReturnAt
                                          ? formatDate(expandedDetail.expectedReturnAt)
                                          : "--"}
                                      </p>
                                    </div>
                                  </>
                                )}
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Created
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                    {formatDateTime(expandedDetail.createdAt)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                    Last Updated
                                  </p>
                                  <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                                    {formatDateTime(expandedDetail.updatedAt)}
                                  </p>
                                </div>
                              </div>

                              {/* Movement history */}
                              {expandedDetail.movements && expandedDetail.movements.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    Movement History ({expandedDetail.movements.length})
                                  </h4>
                                  <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {expandedDetail.movements.map((mv) => (
                                      <div
                                        key={mv.id}
                                        className="flex items-start gap-3 p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700/50"
                                      >
                                        <div className="flex-shrink-0 mt-0.5">
                                          <div className="w-2 h-2 rounded-full bg-karu-green" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                                              {mv.action.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                              {formatDateTime(mv.createdAt)}
                                            </span>
                                          </div>
                                          {mv.performedBy && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                              by {mv.performedBy.displayName || mv.performedBy.name}
                                            </p>
                                          )}
                                          {mv.notes && (
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 italic">
                                              {mv.notes}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-red-500">
                              Failed to load details.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
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
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} records
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchRecords(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <IconChevronLeft />
              </button>

              {Array.from(
                { length: Math.min(pagination.totalPages, 5) },
                (_, i) => {
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
                      onClick={() => fetchRecords(pageNum)}
                      className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                        pageNum === pagination.page
                          ? "bg-karu-green text-white"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
              )}

              <button
                onClick={() => fetchRecords(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <IconChevronRight />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
         Create / Edit Modal
         ================================================================ */}
      <Modal
        open={showCreateEdit}
        onClose={() => setShowCreateEdit(false)}
        title={editingRecord ? "Edit Record" : "New Physical Record"}
      >
        <form onSubmit={handleSaveRecord} className="space-y-4">
          <Field label="Title" required>
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
              placeholder="e.g. Student admission files 2024"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Box Number">
              <input
                type="text"
                value={formBox}
                onChange={(e) => setFormBox(e.target.value)}
                placeholder="e.g. B-0042"
                className={inputClass}
              />
            </Field>
            <Field label="Shelf Location">
              <input
                type="text"
                value={formShelf}
                onChange={(e) => setFormShelf(e.target.value)}
                placeholder="e.g. Rack 3, Shelf A"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Off-site Location">
            <input
              type="text"
              value={formOffSite}
              onChange={(e) => setFormOffSite(e.target.value)}
              placeholder="e.g. Warehouse B, Nakuru"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Barcode">
              <input
                type="text"
                value={formBarcode}
                onChange={(e) => setFormBarcode(e.target.value)}
                placeholder="e.g. 7890123456"
                className={inputClass}
              />
            </Field>
            <Field label="Document ID">
              <input
                type="text"
                value={formDocumentId}
                onChange={(e) => setFormDocumentId(e.target.value)}
                placeholder="Link to digital doc"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateEdit(false)}
              className="h-10 px-4 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formSaving || !formTitle.trim()}
              className="h-10 px-5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {formSaving
                ? "Saving..."
                : editingRecord
                ? "Update Record"
                : "Create Record"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ================================================================
         Checkout Modal
         ================================================================ */}
      <Modal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        title="Check Out Record"
      >
        <form onSubmit={handleCheckout} className="space-y-4">
          {checkoutRecord && (
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {checkoutRecord.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                {checkoutRecord.referenceNumber}
              </p>
            </div>
          )}

          <Field label="Expected Return Date">
            <input
              type="date"
              value={coExpectedReturn}
              onChange={(e) => setCoExpectedReturn(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={coNotes}
              onChange={(e) => setCoNotes(e.target.value)}
              rows={3}
              placeholder="Reason for checkout, destination, etc."
              className={textareaClass}
            />
          </Field>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCheckout(false)}
              className="h-10 px-4 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={coSaving}
              className="h-10 px-5 rounded-xl bg-karu-gold text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {coSaving ? "Checking Out..." : "Check Out"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ================================================================
         Detail Modal
         ================================================================ */}
      <Modal
        open={showDetail}
        onClose={() => {
          setShowDetail(false);
          setDetailRecord(null);
        }}
        title="Record Details"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-gray-200 dark:border-gray-700 border-t-karu-green rounded-full animate-spin" />
          </div>
        ) : detailRecord ? (
          <div className="space-y-5">
            {/* Title + status */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {detailRecord.title}
              </h3>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {detailRecord.referenceNumber}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_BADGE[detailRecord.status] ?? STATUS_BADGE.AVAILABLE
                  }`}
                >
                  {STATUS_LABEL[detailRecord.status] ?? detailRecord.status}
                </span>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Box Number
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                  {detailRecord.boxNumber || "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Shelf Location
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                  {detailRecord.shelfLocation || "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Off-site Location
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                  {detailRecord.offSiteLocation || "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Barcode
                </p>
                <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-0.5">
                  {detailRecord.barcode || "--"}
                </p>
              </div>
              {detailRecord.checkedOutTo && (
                <>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                      Checked Out To
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5 font-medium">
                      {detailRecord.checkedOutTo}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                      Expected Return
                    </p>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                      {detailRecord.expectedReturnAt
                        ? formatDate(detailRecord.expectedReturnAt)
                        : "--"}
                    </p>
                  </div>
                </>
              )}
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Created
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                  {formatDateTime(detailRecord.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
                  Last Updated
                </p>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                  {formatDateTime(detailRecord.updatedAt)}
                </p>
              </div>
            </div>

            {/* Movement history */}
            {detailRecord.movements && detailRecord.movements.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Movement History ({detailRecord.movements.length})
                </h4>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {detailRecord.movements.map((mv) => (
                    <div
                      key={mv.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50"
                    >
                      <div className="flex-shrink-0 mt-1">
                        <div className="w-2 h-2 rounded-full bg-karu-green" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {mv.action.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {formatDateTime(mv.createdAt)}
                          </span>
                        </div>
                        {mv.performedBy && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            by{" "}
                            {mv.performedBy.displayName || mv.performedBy.name}
                          </p>
                        )}
                        {mv.notes && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">
                            {mv.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailRecord.movements && detailRecord.movements.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                No movement history yet.
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <IconAlert className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load record details.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
