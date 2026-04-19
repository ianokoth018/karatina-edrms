"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ---------- types ---------- */

interface UserInfo {
  id: string;
  name: string;
  displayName: string;
  jobTitle?: string | null;
  department?: string | null;
}

interface Certificate {
  id: string;
  certificateNo: string;
  disposalDate: string;
  disposalMethod: string;
  approvedBy: UserInfo;
  witness: UserInfo | null;
  documentIds: string[];
  documentCount: number;
  remarks: string | null;
  status: string;
  createdAt: string;
  executedAt: string | null;
}

interface DispositionDoc {
  id: string;
  referenceNumber: string;
  title: string;
  documentType: string;
  department: string;
  status: string;
  retentionExpiresAt: string | null;
}

interface SearchUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
}

interface DocDetail {
  id: string;
  referenceNumber: string;
  title: string;
  documentType: string;
}

/* ---------- constants ---------- */

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  DRAFT: {
    bg: "bg-yellow-100 dark:bg-yellow-950/40",
    text: "text-yellow-700 dark:text-yellow-400",
  },
  APPROVED: {
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-400",
  },
  EXECUTED: {
    bg: "bg-green-100 dark:bg-green-950/40",
    text: "text-green-700 dark:text-green-400",
  },
};

const METHOD_LABELS: Record<string, string> = {
  SHREDDING: "Shredding",
  INCINERATION: "Incineration",
  DIGITAL_DELETION: "Digital Deletion",
  RECYCLING: "Recycling",
};

/* ---------- helpers ---------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateFormal(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ---------- icons ---------- */

function PlusIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-5 h-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function XMarkIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

/* ---------- component ---------- */

export default function DispositionCertificatePage() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<DocDetail[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [dispositionDocs, setDispositionDocs] = useState<DispositionDoc[]>([]);
  const [loadingDisposDocs, setLoadingDisposDocs] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [disposalMethod, setDisposalMethod] = useState("");
  const [disposalDate, setDisposalDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [witnessQuery, setWitnessQuery] = useState("");
  const [witnessResults, setWitnessResults] = useState<SearchUser[]>([]);
  const [selectedWitness, setSelectedWitness] = useState<SearchUser | null>(null);
  const [showWitnessDropdown, setShowWitnessDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const witnessRef = useRef<HTMLDivElement>(null);

  // Fetch certificates
  const fetchCertificates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/records/disposition/certificate?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCertificates(data.certificates ?? []);
        setTotalPages(data.pagination?.totalPages ?? 1);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  // Fetch documents for expanded certificate
  async function fetchCertificateDocs(docIds: string[]) {
    setLoadingDocs(true);
    try {
      const docs: DocDetail[] = [];
      // Fetch in batch using the documents API
      const res = await fetch(`/api/documents?ids=${docIds.join(",")}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        const items = data.documents ?? data.items ?? [];
        for (const d of items) {
          docs.push({
            id: d.id,
            referenceNumber: d.referenceNumber,
            title: d.title,
            documentType: d.documentType,
          });
        }
      }
      // Fill missing docs with ID-only placeholders
      for (const id of docIds) {
        if (!docs.find((d) => d.id === id)) {
          docs.push({ id, referenceNumber: "N/A", title: "Document unavailable", documentType: "Unknown" });
        }
      }
      setExpandedDocs(docs);
    } catch {
      setExpandedDocs(
        docIds.map((id) => ({ id, referenceNumber: "N/A", title: "Document unavailable", documentType: "Unknown" }))
      );
    } finally {
      setLoadingDocs(false);
    }
  }

  function toggleExpand(cert: Certificate) {
    if (expandedId === cert.id) {
      setExpandedId(null);
      setExpandedDocs([]);
    } else {
      setExpandedId(cert.id);
      const docIds = Array.isArray(cert.documentIds) ? cert.documentIds : [];
      fetchCertificateDocs(docIds);
    }
  }

  // Fetch disposition queue for modal
  async function openModal() {
    setShowModal(true);
    setLoadingDisposDocs(true);
    setSelectedDocIds(new Set());
    setDisposalMethod("");
    setDisposalDate("");
    setRemarks("");
    setSelectedWitness(null);
    setWitnessQuery("");

    try {
      const res = await fetch("/api/records/disposition?limit=100");
      if (res.ok) {
        const data = await res.json();
        setDispositionDocs(data.documents ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingDisposDocs(false);
    }
  }

  // Witness search
  useEffect(() => {
    if (witnessQuery.length < 2) {
      setWitnessResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(witnessQuery)}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          setWitnessResults(data.users ?? []);
          setShowWitnessDropdown(true);
        }
      } catch {
        // silently fail
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [witnessQuery]);

  // Close witness dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (witnessRef.current && !witnessRef.current.contains(e.target as Node)) {
        setShowWitnessDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleDocSelect(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedDocIds.size === dispositionDocs.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(dispositionDocs.map((d) => d.id)));
    }
  }

  async function handleCreate() {
    if (selectedDocIds.size === 0 || !disposalMethod || !disposalDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/records/disposition/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: Array.from(selectedDocIds),
          disposalMethod,
          disposalDate,
          remarks: remarks || undefined,
          witnessId: selectedWitness?.id || undefined,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        fetchCertificates();
      }
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(certId: string, newStatus: string) {
    setActionLoading(certId);
    try {
      const res = await fetch("/api/records/disposition/certificate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificateId: certId, status: newStatus }),
      });
      if (res.ok) {
        fetchCertificates();
        if (expandedId === certId) {
          // Re-fetch to update expanded view
          const updated = await res.json();
          setCertificates((prev) =>
            prev.map((c) => (c.id === certId ? updated : c))
          );
        }
      }
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
    }
  }

  function handlePrint(certId: string) {
    // Open a new window targeting the specific certificate section for print
    const el = document.getElementById(`cert-print-${certId}`);
    if (!el) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Disposition Certificate</title>
        <style>
          body { font-family: 'Times New Roman', serif; padding: 40px; color: #000; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; font-size: 13px; }
          th { background: #f5f5f5; font-weight: bold; }
          h1 { text-align: center; margin: 0; font-size: 18px; }
          h2 { text-align: center; margin: 4px 0 20px; font-size: 16px; text-decoration: underline; }
          .header-text { text-align: center; margin: 0; font-size: 14px; }
          .sig-line { border-top: 1px solid #333; width: 250px; margin-top: 40px; padding-top: 4px; }
          .sig-section { display: flex; justify-content: space-between; margin-top: 40px; }
          .sig-block { width: 45%; }
          .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
          .remarks { margin-top: 20px; padding: 12px; border: 1px solid #ccc; min-height: 40px; font-size: 13px; }
        </style>
      </head>
      <body>${el.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Disposition Certificates
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Certificates of destruction for records disposal
          </p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-[#02773b] hover:bg-[#025f2f] transition-colors shadow-sm"
        >
          <PlusIcon />
          Generate Certificate
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 text-gray-900 dark:text-gray-100"
        >
          <option value="">All</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved</option>
          <option value="EXECUTED">Executed</option>
        </select>
      </div>

      {/* Certificates Table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 dark:border-gray-700 border-t-[#02773b] rounded-full animate-spin" />
          </div>
        ) : certificates.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
            No disposition certificates found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-8" />
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Certificate No
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Method
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Documents
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {certificates.map((cert) => {
                  const isExpanded = expandedId === cert.id;
                  const badge = STATUS_BADGE[cert.status] ?? STATUS_BADGE.DRAFT;

                  return (
                    <TableRowWithExpand
                      key={cert.id}
                      cert={cert}
                      badge={badge}
                      isExpanded={isExpanded}
                      expandedDocs={expandedDocs}
                      loadingDocs={loadingDocs}
                      actionLoading={actionLoading}
                      onToggle={() => toggleExpand(cert)}
                      onApprove={() => handleStatusChange(cert.id, "APPROVED")}
                      onExecute={() => handleStatusChange(cert.id, "EXECUTED")}
                      onPrint={() => handlePrint(cert.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* ======= Generate Certificate Modal ======= */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Generate Disposition Certificate
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <XMarkIcon />
              </button>
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* Document selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select Documents from Disposition Queue
                  </label>
                  {dispositionDocs.length > 0 && (
                    <button
                      onClick={toggleSelectAll}
                      className="text-xs text-[#02773b] hover:underline"
                    >
                      {selectedDocIds.size === dispositionDocs.length
                        ? "Deselect all"
                        : "Select all"}
                    </button>
                  )}
                </div>

                {loadingDisposDocs ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-3 border-gray-200 dark:border-gray-700 border-t-[#02773b] rounded-full animate-spin" />
                  </div>
                ) : dispositionDocs.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                    No documents in the disposition queue
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-gray-800 rounded-xl max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {dispositionDocs.map((doc) => (
                      <label
                        key={doc.id}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.id)}
                          onChange={() => toggleDocSelect(doc.id)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-[#02773b] focus:ring-[#02773b]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {doc.title}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {doc.referenceNumber} &middot; {doc.department}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                          {doc.retentionExpiresAt
                            ? formatDate(doc.retentionExpiresAt)
                            : "No date"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {selectedDocIds.size > 0 && (
                  <p className="text-xs text-[#02773b] mt-1">
                    {selectedDocIds.size} document{selectedDocIds.size !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              {/* Disposal Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Disposal Method
                </label>
                <select
                  value={disposalMethod}
                  onChange={(e) => setDisposalMethod(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2.5 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select method...</option>
                  <option value="SHREDDING">Shredding</option>
                  <option value="INCINERATION">Incineration</option>
                  <option value="DIGITAL_DELETION">Digital Deletion</option>
                  <option value="RECYCLING">Recycling</option>
                </select>
              </div>

              {/* Disposal Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Disposal Date
                </label>
                <input
                  type="date"
                  value={disposalDate}
                  onChange={(e) => setDisposalDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2.5 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Witness (user search) */}
              <div ref={witnessRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Witness (optional)
                </label>
                {selectedWitness ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <span className="text-sm text-gray-900 dark:text-gray-100 flex-1">
                      {selectedWitness.displayName}{" "}
                      <span className="text-gray-500 dark:text-gray-400">
                        ({selectedWitness.department ?? "N/A"})
                      </span>
                    </span>
                    <button
                      onClick={() => {
                        setSelectedWitness(null);
                        setWitnessQuery("");
                      }}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <XMarkIcon />
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={witnessQuery}
                    onChange={(e) => setWitnessQuery(e.target.value)}
                    onFocus={() => witnessResults.length > 0 && setShowWitnessDropdown(true)}
                    placeholder="Search by name..."
                    className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2.5 text-gray-900 dark:text-gray-100"
                  />
                )}
                {showWitnessDropdown && witnessResults.length > 0 && !selectedWitness && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                    {witnessResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setSelectedWitness(u);
                          setShowWitnessDropdown(false);
                          setWitnessQuery("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <p className="text-sm text-gray-900 dark:text-gray-100">{u.displayName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {u.jobTitle ?? "Staff"} &middot; {u.department ?? "N/A"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Remarks (optional)
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2.5 text-gray-900 dark:text-gray-100 resize-none"
                  placeholder="Additional notes about this disposition..."
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={
                  submitting ||
                  selectedDocIds.size === 0 ||
                  !disposalMethod ||
                  !disposalDate
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon />
                )}
                Generate Certificate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Table Row Sub-component ---------- */

interface TableRowProps {
  cert: Certificate;
  badge: { bg: string; text: string };
  isExpanded: boolean;
  expandedDocs: DocDetail[];
  loadingDocs: boolean;
  actionLoading: string | null;
  onToggle: () => void;
  onApprove: () => void;
  onExecute: () => void;
  onPrint: () => void;
}

function TableRowWithExpand({
  cert,
  badge,
  isExpanded,
  expandedDocs,
  loadingDocs,
  actionLoading,
  onToggle,
  onApprove,
  onExecute,
  onPrint,
}: TableRowProps) {
  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <ChevronDownIcon open={isExpanded} />
        </td>
        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
          {cert.certificateNo}
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {formatDate(cert.disposalDate)}
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {METHOD_LABELS[cert.disposalMethod] ?? cert.disposalMethod}
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {cert.documentCount}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
          >
            {cert.status}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {cert.status === "DRAFT" && (
              <button
                onClick={onApprove}
                disabled={actionLoading === cert.id}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-950/60 transition-colors disabled:opacity-50"
              >
                Approve
              </button>
            )}
            {cert.status === "APPROVED" && (
              <button
                onClick={onExecute}
                disabled={actionLoading === cert.id}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-950/60 transition-colors disabled:opacity-50"
              >
                Execute
              </button>
            )}
            <button
              onClick={onPrint}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Print certificate"
            >
              <PrinterIcon />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded Detail / Printable Certificate */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-0 py-0">
            <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 px-6 py-6">
              {/* Printable certificate content (hidden div for print) */}
              <div
                id={`cert-print-${cert.id}`}
                className="hidden"
              >
                <PrintableCertificateContent cert={cert} docs={expandedDocs} />
              </div>

              {/* On-screen formal certificate preview */}
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto">
                {/* University Header */}
                <div className="text-center mb-6">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 tracking-wide uppercase">
                    Karatina University
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Electronic Document and Records Management System
                  </p>
                  <div className="mt-3 mx-auto w-16 border-t-2 border-[#02773b]" />
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mt-3 uppercase tracking-wider">
                    Certificate of Destruction
                  </h3>
                </div>

                {/* Certificate metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mb-6 text-sm">
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Certificate No:</span>{" "}
                    <span className="text-gray-900 dark:text-gray-100">{cert.certificateNo}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Disposal Date:</span>{" "}
                    <span className="text-gray-900 dark:text-gray-100">{formatDateFormal(cert.disposalDate)}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Disposal Method:</span>{" "}
                    <span className="text-gray-900 dark:text-gray-100">
                      {METHOD_LABELS[cert.disposalMethod] ?? cert.disposalMethod}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Status:</span>{" "}
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                      {cert.status}
                    </span>
                  </div>
                </div>

                {/* Documents table */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Documents Disposed ({cert.documentCount})
                  </h4>
                  {loadingDocs ? (
                    <div className="flex items-center justify-center py-6">
                      <div className="w-5 h-5 border-2 border-gray-200 dark:border-gray-700 border-t-[#02773b] rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400 text-xs">
                              #
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400 text-xs">
                              Ref Number
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400 text-xs">
                              Title
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400 text-xs">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {expandedDocs.map((doc, idx) => (
                            <tr key={doc.id}>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{idx + 1}</td>
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-300 font-mono text-xs">
                                {doc.referenceNumber}
                              </td>
                              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{doc.title}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{doc.documentType}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Remarks */}
                {cert.remarks && (
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Remarks</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl px-4 py-3">
                      {cert.remarks}
                    </p>
                  </div>
                )}

                {/* Signature blocks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
                  <div>
                    <div className="h-16" />
                    <div className="border-t border-gray-400 dark:border-gray-600 pt-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {cert.approvedBy.displayName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {cert.approvedBy.jobTitle ?? "Records Officer"}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Approved By
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="h-16" />
                    <div className="border-t border-gray-400 dark:border-gray-600 pt-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {cert.witness?.displayName ?? "____________________"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {cert.witness?.jobTitle ?? "Designation"}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Witnessed By
                      </p>
                    </div>
                  </div>
                </div>

                {cert.executedAt && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 text-center">
                    Executed on {formatDateFormal(cert.executedAt)}
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------- Printable certificate (raw HTML for print window) ---------- */

function PrintableCertificateContent({
  cert,
  docs,
}: {
  cert: Certificate;
  docs: DocDetail[];
}) {
  return (
    <div>
      <h1>KARATINA UNIVERSITY</h1>
      <p className="header-text">Electronic Document and Records Management System</p>
      <h2>CERTIFICATE OF DESTRUCTION</h2>

      <div className="meta-row">
        <span><strong>Certificate No:</strong> {cert.certificateNo}</span>
        <span><strong>Date:</strong> {formatDateFormal(cert.disposalDate)}</span>
      </div>
      <div className="meta-row">
        <span><strong>Disposal Method:</strong> {METHOD_LABELS[cert.disposalMethod] ?? cert.disposalMethod}</span>
        <span><strong>Status:</strong> {cert.status}</span>
      </div>

      <br />
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Ref Number</th>
            <th>Title</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc, idx) => (
            <tr key={doc.id}>
              <td>{idx + 1}</td>
              <td>{doc.referenceNumber}</td>
              <td>{doc.title}</td>
              <td>{doc.documentType}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {cert.remarks && (
        <div className="remarks">
          <strong>Remarks:</strong> {cert.remarks}
        </div>
      )}

      <div className="sig-section">
        <div className="sig-block">
          <div className="sig-line">
            <strong>{cert.approvedBy.displayName}</strong>
            <br />
            {cert.approvedBy.jobTitle ?? "Records Officer"}
            <br />
            <em>Approved By</em>
          </div>
        </div>
        <div className="sig-block">
          <div className="sig-line">
            <strong>{cert.witness?.displayName ?? "____________________"}</strong>
            <br />
            {cert.witness?.jobTitle ?? "Designation"}
            <br />
            <em>Witnessed By</em>
          </div>
        </div>
      </div>
    </div>
  );
}
