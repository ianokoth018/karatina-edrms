"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ---------- types ---------- */

interface UserResult {
  id: string;
  name: string;
  displayName?: string | null;
  email?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  roles?: string[];
}

type AccessLevel = "viewer" | "editor" | "full";
type ExpiresIn = "1d" | "7d" | "30d" | "never";

interface ShareLinkRow {
  id: string;
  token: string;
  url?: string;
  email: string | null;
  canDownload: boolean;
  canPrint: boolean;
  expiresAt: string | null;
  accessCount: number;
  createdAt?: string;
}

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
}

/* ---------- helpers ---------- */

function initialsFor(user: UserResult): string {
  const name = (user.displayName ?? user.name ?? "?").trim();
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "Never expires";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = then - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days >= 1) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m left`;
}

/* ---------- tiny icons ---------- */

const IconClose = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);
const IconSearch = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);
const IconCopy = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75A1.125 1.125 0 0 1 3.75 20.625V7.875c0-.621.504-1.125 1.125-1.125H6.75M15.75 17.25h3.375c.621 0 1.125-.504 1.125-1.125V9.75M15.75 17.25h-3.375a1.125 1.125 0 0 1-1.125-1.125V9.75m0 0V5.625c0-.621.504-1.125 1.125-1.125H15l5.25 5.25v.75" />
  </svg>
);
const IconLink = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
  </svg>
);
const IconCheck = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

/* ---------- Toggle ---------- */

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${
          checked ? "bg-karu-green" : "bg-gray-300 dark:bg-gray-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {description && <span className="block text-xs text-gray-500 dark:text-gray-400">{description}</span>}
      </span>
    </label>
  );
}

/* ---------- main component ---------- */

export function ShareDialog({ open, onClose, documentId, documentTitle }: ShareDialogProps) {
  const [tab, setTab] = useState<"people" | "link">("people");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* ----- People tab state ----- */
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<UserResult[]>([]);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("viewer");
  const [message, setMessage] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [departmentOptions, setDepartmentOptions] = useState<{ name: string; userCount: number }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----- Link tab state ----- */
  const [linkEmail, setLinkEmail] = useState("");
  const [expiresIn, setExpiresIn] = useState<ExpiresIn>("7d");
  const [canDownload, setCanDownload] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [emailLinkToo, setEmailLinkToo] = useState(true);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [justCreatedLink, setJustCreatedLink] = useState<ShareLinkRow | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeLinks, setActiveLinks] = useState<ShareLinkRow[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);

  /* ----- reset on close ----- */
  useEffect(() => {
    if (!open) {
      setTab("people");
      setSearch("");
      setSearchResults([]);
      setSelected([]);
      setAccessLevel("viewer");
      setMessage("");
      setAlsoEmail(true);
      setLinkEmail("");
      setExpiresIn("7d");
      setCanDownload(false);
      setCanPrint(false);
      setEmailLinkToo(true);
      setJustCreatedLink(null);
      setLinkCopied(false);
      setDepartmentFilter("");
      setShowDropdown(false);
      setError(null);
    }
  }, [open]);

  /* ----- load departments once when dialog opens ----- */
  useEffect(() => {
    if (!open || departmentOptions.length > 0) return;
    fetch("/api/users/search?departments=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.departments) setDepartmentOptions(data.departments);
      })
      .catch(() => {});
  }, [open, departmentOptions.length]);

  /* ----- fetch user list (all or filtered) whenever query/department/selected changes ----- */
  useEffect(() => {
    if (!open || tab !== "people") return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const excludeIds = selected.map((u) => u.id).join(",");
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        if (departmentFilter) params.set("department", departmentFilter);
        params.set("limit", "50");
        if (excludeIds) params.set("exclude", excludeIds);
        const res = await fetch(`/api/users/search?${params.toString()}`);
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = await res.json();
        setSearchResults((data.users ?? []) as UserResult[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "User search failed");
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [open, tab, search, departmentFilter, selected]);

  /* ----- fetch active share links when Tab 2 opens ----- */
  const fetchLinks = useCallback(async () => {
    setIsLoadingLinks(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/share-link`);
      if (!res.ok) throw new Error(`Failed to load links (${res.status})`);
      const data = await res.json();
      const rows: ShareLinkRow[] = Array.isArray(data) ? data : (data.links ?? []);
      setActiveLinks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load share links");
    } finally {
      setIsLoadingLinks(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (open && tab === "link") {
      fetchLinks();
    }
  }, [open, tab, fetchLinks]);

  /* ----- dismiss toast ----- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----- escape-to-close ----- */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function addUser(u: UserResult) {
    if (selected.some((s) => s.id === u.id)) return;
    setSelected([...selected, u]);
    setSearch("");
    // Keep dropdown open so the user can keep adding recipients quickly.
    setShowDropdown(true);
  }

  function removeUser(id: string) {
    setSelected(selected.filter((s) => s.id !== id));
  }

  /* ----- submit People ----- */
  async function handleSend() {
    if (selected.length === 0) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selected.map((u) => u.id),
          accessLevel,
          message: message.trim() || undefined,
          sendEmail: alsoEmail,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Share failed (${res.status})`);
      }
      setToast(`Shared with ${selected.length} ${selected.length === 1 ? "person" : "people"}`);
      setTimeout(onClose, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to share document");
    } finally {
      setIsSending(false);
    }
  }

  /* ----- create link -----
   * Supports multiple recipients: emails are split on commas/semicolons/whitespace.
   * One DocumentShareLink is created per address so each recipient is trackable
   * and revocable independently. When no email is provided, a single link is
   * created that can be copied/sent manually. */
  async function handleCreateLink() {
    setIsCreatingLink(true);
    setError(null);
    try {
      const rawEmails = linkEmail
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);

      const payloads =
        rawEmails.length === 0
          ? [{ email: undefined, sendEmail: false }]
          : rawEmails.map((email) => ({
              email,
              sendEmail: emailLinkToo,
            }));

      const created: ShareLinkRow[] = [];
      for (const partial of payloads) {
        const res = await fetch(`/api/documents/${documentId}/share-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...partial,
            canDownload,
            canPrint,
            expiresIn,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Create link failed (${res.status})`);
        }
        created.push((await res.json()) as ShareLinkRow);
      }
      setJustCreatedLink(created[0] ?? null);
      setActiveLinks((prev) => [...created, ...prev]);
      setToast(
        created.length > 1
          ? `${created.length} share links created`
          : "Share link created"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setIsCreatingLink(false);
    }
  }

  /* ----- revoke ----- */
  async function handleRevoke(linkId: string) {
    if (!confirm("Revoke this share link? Anyone using it will lose access.")) return;
    setError(null);
    const prev = activeLinks;
    setActiveLinks((list) => list.filter((l) => l.id !== linkId));
    if (justCreatedLink?.id === linkId) setJustCreatedLink(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/share-link/${linkId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Revoke failed (${res.status})`);
      setToast("Link revoked");
    } catch (e) {
      setActiveLinks(prev); // rollback
      setError(e instanceof Error ? e.message : "Failed to revoke link");
    }
  }

  /* ----- copy link ----- */
  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setToast("Link copied");
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share this document"
        className="relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-[640px] max-h-[90vh] flex flex-col overflow-hidden animate-slide-up"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Share this document</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{documentTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-gray-200 dark:border-gray-800 flex gap-1">
          {([
            { id: "people", label: "People" },
            { id: "link", label: "Email link" },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id ? "text-karu-green" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-karu-green rounded-full" />}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-2.5 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-red-700 dark:text-red-300 flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Dismiss</button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === "people" ? (
            <div className="px-6 py-5 space-y-5">
              {/* Chips */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-karu-green/10 text-karu-green dark:bg-karu-green/20 text-sm font-medium"
                    >
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-karu-green text-white text-[10px] font-semibold">
                        {initialsFor(u)}
                      </span>
                      <span className="truncate max-w-[160px]">{u.displayName ?? u.name}</span>
                      <button
                        onClick={() => removeUser(u.id)}
                        className="ml-0.5 p-0.5 rounded-full hover:bg-karu-green/20"
                        aria-label={`Remove ${u.displayName ?? u.name}`}
                      >
                        <IconClose className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search + department filter row */}
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onFocus={() => setShowDropdown(true)}
                    onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
                    placeholder="Search people by name, email, or department…"
                    className="w-full h-11 pl-10 pr-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-all"
                  />
                </div>
                <select
                  value={departmentFilter}
                  onChange={(e) => { setDepartmentFilter(e.target.value); setShowDropdown(true); }}
                  className="h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-all max-w-[180px]"
                  title="Filter by department"
                >
                  <option value="">All departments</option>
                  {departmentOptions.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} ({d.userCount})
                    </option>
                  ))}
                </select>
              </div>

              {/* Results list — always shown when dropdown is open */}
              {showDropdown && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  {isSearching ? (
                    <div className="px-4 py-3 text-sm text-gray-500">Loading…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">No matching users</div>
                  ) : (
                    searchResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => addUser(u)}
                        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                      >
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-karu-gold/20 text-karu-green font-semibold text-xs">
                          {initialsFor(u)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {u.displayName ?? u.name}
                            </span>
                            {u.roles && u.roles.length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-karu-green/10 text-karu-green text-[10px] font-medium">
                                {u.roles[0]}
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                            {[u.department, u.email].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Access level */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Access level</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: "viewer", title: "Viewer", desc: "read & download" },
                    { id: "editor", title: "Editor", desc: "read, edit & download" },
                    { id: "full", title: "Full", desc: "read, edit, delete, share" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAccessLevel(opt.id)}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        accessLevel === opt.id
                          ? "border-karu-green bg-karu-green/5 dark:bg-karu-green/10"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                            accessLevel === opt.id ? "border-karu-green bg-karu-green" : "border-gray-300 dark:border-gray-600"
                          }`}
                        />
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{opt.title}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Note</label>
                <textarea
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a note (optional)…"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 resize-none"
                />
              </div>

              {/* Email toggle */}
              <Toggle
                checked={alsoEmail}
                onChange={setAlsoEmail}
                label="Also email the recipients"
                description="Send a notification with the note and access link."
              />
            </div>
          ) : (
            <div className="px-6 py-5 space-y-5">
              {/* Link builder */}
              {!justCreatedLink && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      Recipient emails (optional)
                    </label>
                    <input
                      type="text"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      placeholder="name@karu.ac.ke, another@karu.ac.ke"
                      className="w-full h-11 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-all"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Separate multiple emails with commas. Each recipient gets a unique link they can revoke independently. Leave blank to just create a copy-paste link.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Expires in</label>
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { id: "1d", label: "24 hours" },
                        { id: "7d", label: "7 days" },
                        { id: "30d", label: "30 days" },
                        { id: "never", label: "Never" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setExpiresIn(opt.id)}
                          className={`h-10 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                            expiresIn === opt.id
                              ? "border-karu-green bg-karu-green/5 dark:bg-karu-green/10 text-karu-green"
                              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                    <Toggle checked={canDownload} onChange={setCanDownload} label="Allow download" />
                    <Toggle checked={canPrint} onChange={setCanPrint} label="Allow print" />
                    {linkEmail.trim().length > 0 && (
                      <Toggle
                        checked={emailLinkToo}
                        onChange={setEmailLinkToo}
                        label="Email the link to this address"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Created link panel */}
              {justCreatedLink && (
                <div className="rounded-xl border-2 border-karu-green/40 bg-karu-green/5 dark:bg-karu-green/10 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-karu-green">
                    <IconCheck className="w-4 h-4" />
                    Link ready to share
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={justCreatedLink.url ?? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${justCreatedLink.token}`}
                      className="flex-1 h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono text-xs text-gray-700 dark:text-gray-300 outline-none"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={() =>
                        handleCopy(
                          justCreatedLink.url ??
                            `${typeof window !== "undefined" ? window.location.origin : ""}/share/${justCreatedLink.token}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors"
                    >
                      {linkCopied ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
                      {linkCopied ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => handleRevoke(justCreatedLink.id)}
                      className="h-10 px-3 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      Revoke
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                    <span>{formatExpiry(justCreatedLink.expiresAt)}</span>
                    <span>{justCreatedLink.canDownload ? "Download allowed" : "View-only"}</span>
                    {justCreatedLink.canPrint && <span>Print allowed</span>}
                    {justCreatedLink.email && <span>Sent to {justCreatedLink.email}</span>}
                  </div>
                  <button
                    onClick={() => setJustCreatedLink(null)}
                    className="text-xs text-karu-green font-medium hover:underline"
                  >
                    ← Create another link
                  </button>
                </div>
              )}

              {/* Active links */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Active share links
                  </label>
                  {!isLoadingLinks && (
                    <button
                      onClick={fetchLinks}
                      className="text-xs text-gray-500 hover:text-karu-green transition-colors"
                    >
                      Refresh
                    </button>
                  )}
                </div>
                {isLoadingLinks ? (
                  <div className="text-sm text-gray-500 py-4 text-center">Loading…</div>
                ) : activeLinks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    <IconLink className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                    No active links yet.
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-200 dark:divide-gray-800">
                    {activeLinks.map((link) => (
                      <div key={link.id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {link.email ?? "Anyone with the link"}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatExpiry(link.expiresAt)} · {link.accessCount} view{link.accessCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleCopy(
                              link.url ?? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`
                            )
                          }
                          className="p-1.5 rounded-lg text-gray-400 hover:text-karu-green hover:bg-karu-green/10 transition-colors"
                          title="Copy link"
                        >
                          <IconCopy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRevoke(link.id)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2 bg-gray-50/50 dark:bg-gray-900/50">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          {tab === "people" ? (
            <button
              onClick={handleSend}
              disabled={selected.length === 0 || isSending}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? "Sending…" : `Send${selected.length > 0 ? ` to ${selected.length}` : ""}`}
            </button>
          ) : (
            !justCreatedLink && (
              <button
                onClick={handleCreateLink}
                disabled={isCreatingLink}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <IconLink className="w-4 h-4" />
                {isCreatingLink ? "Creating…" : "Create link"}
              </button>
            )
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium shadow-xl animate-slide-up">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareDialog;
