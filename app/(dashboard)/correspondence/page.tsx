"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Can } from "@/components/auth/can";

/* ---------- types ---------- */

interface CorrespondenceUser {
  id: string;
  name: string;
  displayName: string;
  department?: string;
}

interface CorrespondenceRow {
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
  assignedTo: CorrespondenceUser | null;
  createdBy: CorrespondenceUser;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UserOption {
  id: string;
  name: string;
  displayName: string;
  department: string | null;
}

/* ---------- constants ---------- */

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  RECEIVED: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  REGISTERED: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  ASSIGNED: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  IN_PROGRESS: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  PENDING_APPROVAL: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  APPROVED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  DISPATCHED: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  CLOSED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  OVERDUE: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  PENDING: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  RESPONDED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
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
  PENDING: "Pending",
  RESPONDED: "Responded",
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

const DISPATCH_METHODS = ["POST", "COURIER", "EMAIL", "HAND_DELIVERY"];

/* ---------- component ---------- */

export default function CorrespondencePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const initialType = searchParams.get("type") === "OUTGOING" ? "OUTGOING" : "INCOMING";

  const [items, setItems] = useState<CorrespondenceRow[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"INCOMING" | "OUTGOING">(initialType);
  const [stats, setStats] = useState({ total: 0, pending: 0, overdue: 0, closedThisMonth: 0 });
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form state
  const [formSubject, setFormSubject] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formPriority, setFormPriority] = useState("NORMAL");
  const [formDispatchMethod, setFormDispatchMethod] = useState("");
  const [formTrackingNumber, setFormTrackingNumber] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formAssignedToId, setFormAssignedToId] = useState("");

  // User search for assign-to
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [selectedUserName, setSelectedUserName] = useState("");

  const fetchItems = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "20");
        params.set("type", activeTab);
        if (filterStatus) params.set("status", filterStatus);
        if (filterPriority) params.set("priority", filterPriority);
        if (search) params.set("search", search);
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);

        const res = await fetch(`/api/correspondence?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? "Failed to fetch correspondence");
        }
        const data = await res.json();
        setItems(data.items);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    },
    [activeTab, filterStatus, filterPriority, search, dateFrom, dateTo]
  );

  useEffect(() => {
    fetchItems(1);
    // Fetch stats
    fetch("/api/correspondence?limit=1000&type=" + activeTab)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.items) return;
        const all = data.items as CorrespondenceRow[];
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        setStats({
          total: data.pagination?.total ?? all.length,
          pending: all.filter((i: CorrespondenceRow) => !["CLOSED", "DISPATCHED"].includes(i.status)).length,
          overdue: all.filter((i: CorrespondenceRow) => i.dueDate && new Date(i.dueDate) < now && !["CLOSED", "DISPATCHED"].includes(i.status)).length,
          closedThisMonth: all.filter((i: CorrespondenceRow) => i.status === "CLOSED" && new Date(i.createdAt) >= monthStart).length,
        });
      })
      .catch(() => {});
  }, [fetchItems, activeTab]);

  // User search effect
  useEffect(() => {
    if (userSearch.length < 2) {
      setUserOptions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users?search=${encodeURIComponent(userSearch)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setUserOptions(data.users ?? data ?? []);
        }
      } catch {
        // ignore search errors
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [userSearch]);

  function resetForm() {
    setFormSubject("");
    setFormFrom("");
    setFormTo("");
    setFormDate("");
    setFormPriority("NORMAL");
    setFormDispatchMethod("");
    setFormTrackingNumber("");
    setFormDescription("");
    setFormDueDate("");
    setFormAssignedToId("");
    setSelectedUserName("");
    setUserSearch("");
    setModalError(null);
  }

  function openModal() {
    resetForm();
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setModalError(null);

    try {
      const payload: Record<string, unknown> = {
        type: activeTab,
        subject: formSubject,
        fromEntity: formFrom,
        toEntity: formTo,
        priority: formPriority,
      };

      if (activeTab === "INCOMING" && formDate) payload.dateReceived = formDate;
      if (activeTab === "OUTGOING" && formDate) payload.dateSent = formDate;
      if (formDueDate) payload.dueDate = formDueDate;
      if (formDescription) payload.description = formDescription;
      if (formDispatchMethod) payload.dispatchMethod = formDispatchMethod;
      if (formTrackingNumber) payload.trackingNumber = formTrackingNumber;
      if (formAssignedToId) payload.assignedToId = formAssignedToId;

      const res = await fetch("/api/correspondence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to register correspondence");
      }

      setShowModal(false);
      resetForm();
      fetchItems(1);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchItems(1);
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "-";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Correspondence Register
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track incoming and outgoing physical mail and letters
          </p>
        </div>

        <Can permission="correspondence:create">
          <button
            onClick={() => router.push("/correspondence/new")}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#025f2f] focus:ring-2 focus:ring-[#02773b]/20 focus:ring-offset-2 whitespace-nowrap"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Register New
          </button>
        </Can>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
          { label: "Pending Action", value: stats.pending, icon: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
          { label: "Overdue", value: stats.overdue, icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z", color: stats.overdue > 0 ? "text-red-600 bg-red-50 dark:bg-red-950/30" : "text-gray-400 bg-gray-50 dark:bg-gray-800" },
          { label: "Closed This Month", value: stats.closedThisMonth, icon: "m4.5 12.75 6 6 9-13.5", color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.color}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Tabs">
          {(["INCOMING", "OUTGOING"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-[#02773b] text-[#02773b]"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {tab === "INCOMING" ? "Incoming Mail" : "Outgoing Mail"}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 animate-slide-up delay-100">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, ref no, sender, recipient..."
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
            />
          </div>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
          >
            <option value="">All Priorities</option>
            {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {/* Date range */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
            title="Date from"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
            title="Date to"
          />

          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#025f2f] transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden animate-slide-up delay-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Ref No</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  {activeTab === "INCOMING" ? "From" : "To"}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Assigned To</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div
                          className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                          style={{ width: `${50 + Math.random() * 50}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                      </svg>
                      <p className="text-gray-500 dark:text-gray-400 font-medium">
                        No {activeTab.toLowerCase()} correspondence found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {search ? "Try adjusting your search or filters" : "Register new correspondence to get started"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/correspondence/${item.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.referenceNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-xs">
                        {item.subject}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      <div className="truncate max-w-[180px]">
                        {activeTab === "INCOMING" ? item.fromEntity : item.toEntity}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {activeTab === "INCOMING"
                        ? formatDate(item.dateReceived)
                        : formatDate(item.dateSent)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[item.status] ?? STATUS_STYLES.PENDING}`}>
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.NORMAL}`}>
                        {PRIORITY_LABELS[item.priority] ?? item.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                      {item.assignedTo ? (item.assignedTo.displayName || item.assignedTo.name) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/correspondence/${item.id}`);
                        }}
                        className="text-[#02773b] hover:text-[#025f2f] text-xs font-medium transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
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
              of {pagination.total}
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchItems(pagination.page - 1)}
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
                    onClick={() => fetchItems(pageNum)}
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
                onClick={() => fetchItems(pagination.page + 1)}
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 rounded-t-2xl z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Register {activeTab === "INCOMING" ? "Incoming" : "Outgoing"} Correspondence
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {modalError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{modalError}</p>
                </div>
              )}

              {/* Type indicator */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  activeTab === "INCOMING"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                }`}>
                  {activeTab === "INCOMING" ? "Incoming Mail" : "Outgoing Mail"}
                </span>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  required
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                  placeholder="Subject of the correspondence"
                />
              </div>

              {/* From / To row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    From <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formFrom}
                    onChange={(e) => setFormFrom(e.target.value)}
                    required
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                    placeholder={activeTab === "INCOMING" ? "Sender name / organization" : "Department / office"}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    To <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formTo}
                    onChange={(e) => setFormTo(e.target.value)}
                    required
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                    placeholder={activeTab === "INCOMING" ? "Recipient department" : "External recipient"}
                  />
                </div>
              </div>

              {/* Date / Priority row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {activeTab === "INCOMING" ? "Date Received" : "Date Sent"}
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Priority
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Response Due Date
                </label>
                <input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                />
              </div>

              {/* Dispatch Method / Tracking */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Dispatch Method
                  </label>
                  <select
                    value={formDispatchMethod}
                    onChange={(e) => setFormDispatchMethod(e.target.value)}
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                  >
                    <option value="">Select method...</option>
                    {DISPATCH_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Tracking Number
                  </label>
                  <input
                    type="text"
                    value={formTrackingNumber}
                    onChange={(e) => setFormTrackingNumber(e.target.value)}
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                    placeholder="Courier tracking number"
                  />
                </div>
              </div>

              {/* Assign To */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Assign To
                </label>
                {selectedUserName ? (
                  <div className="flex items-center gap-2 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3">
                    <span className="text-sm text-gray-900 dark:text-gray-100 flex-1">{selectedUserName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFormAssignedToId("");
                        setSelectedUserName("");
                        setUserSearch("");
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setShowUserDropdown(true);
                    }}
                    onFocus={() => setShowUserDropdown(true)}
                    className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                    placeholder="Search for a user to assign..."
                  />
                )}
                {showUserDropdown && userOptions.length > 0 && !selectedUserName && (
                  <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {userOptions.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setFormAssignedToId(user.id);
                          setSelectedUserName(user.displayName || user.name);
                          setShowUserDropdown(false);
                          setUserSearch("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {user.displayName || user.name}
                        </div>
                        {user.department && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{user.department}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 resize-none"
                  placeholder="Additional notes or description..."
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="h-10 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-10 px-5 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#025f2f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {isSubmitting && (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
