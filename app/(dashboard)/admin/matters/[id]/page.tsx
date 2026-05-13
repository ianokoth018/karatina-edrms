"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";

interface UserLite {
  id: string;
  displayName: string;
  name: string;
  email: string;
  department: string | null;
}

interface NoticeRow {
  id: string;
  sentAt: string;
  acknowledgedAt: string | null;
}

interface CustodianRow {
  id: string;
  userId: string | null;
  externalName: string | null;
  externalEmail: string | null;
  addedAt: string;
  notice: NoticeRow | null;
  user: UserLite | null;
}

interface DocRow {
  matterId: string;
  documentId: string;
  addedAt: string;
  document: {
    id: string;
    referenceNumber: string;
    title: string;
    documentType: string;
  };
}

interface MatterDetail {
  id: string;
  name: string;
  matterNumber: string;
  description: string | null;
  status: "OPEN" | "CLOSED" | string;
  openedAt: string;
  closedAt: string | null;
  custodians: CustodianRow[];
  documents: DocRow[];
  notices: NoticeRow[];
}

export default function MatterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { can, ready } = usePermissions();
  const [matter, setMatter] = useState<MatterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Add custodian form
  const [showAddCustodian, setShowAddCustodian] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserLite[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [custodianMode, setCustodianMode] = useState<"internal" | "external">("internal");

  // Add documents form
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [docResults, setDocResults] = useState<Array<{ id: string; referenceNumber: string; title: string }>>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/matters/${id}`);
      if (!res.ok) throw new Error("Failed to load matter");
      const data = await res.json();
      setMatter(data.matter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready && can("admin:manage")) load();
  }, [ready, can, load]);

  // Debounced user search
  useEffect(() => {
    if (custodianMode !== "internal") {
      setUserResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(userQuery)}&limit=10`);
        if (!res.ok) return;
        const data = await res.json();
        setUserResults(data.users ?? []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [userQuery, custodianMode]);

  // Debounced document search — uses the existing search endpoint
  useEffect(() => {
    if (!showAddDocs) return;
    const handle = setTimeout(async () => {
      if (!docQuery.trim()) {
        setDocResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/documents?search=${encodeURIComponent(docQuery)}&limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        // Accept either { documents } or { data } shape — be tolerant.
        const rows = (data.documents ?? data.data ?? []) as Array<{
          id: string;
          referenceNumber: string;
          title: string;
        }>;
        setDocResults(rows);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [docQuery, showAddDocs]);

  async function addInternalCustodian(user: UserLite) {
    setBusy("addCustodian");
    setError(null);
    try {
      const res = await fetch(`/api/admin/matters/${id}/custodians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to add custodian");
      }
      setUserQuery("");
      setUserResults([]);
      setShowAddCustodian(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add custodian");
    } finally {
      setBusy(null);
    }
  }

  async function addExternalCustodian() {
    if (!extEmail.trim()) return;
    setBusy("addCustodian");
    setError(null);
    try {
      const res = await fetch(`/api/admin/matters/${id}/custodians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalName: extName.trim() || undefined,
          externalEmail: extEmail.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to add custodian");
      }
      setExtName("");
      setExtEmail("");
      setShowAddCustodian(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add custodian");
    } finally {
      setBusy(null);
    }
  }

  async function removeCustodian(custodianId: string) {
    if (!confirm("Remove this custodian from the matter?")) return;
    setBusy(`removeCust:${custodianId}`);
    try {
      await fetch(`/api/admin/matters/${id}/custodians/${custodianId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function attachSelectedDocs() {
    if (selectedDocs.size === 0) return;
    setBusy("attachDocs");
    setError(null);
    try {
      const res = await fetch(`/api/admin/matters/${id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: Array.from(selectedDocs) }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to attach documents");
      }
      const data = await res.json();
      setInfo(`Attached ${data.added} document(s) to this matter.`);
      setSelectedDocs(new Set());
      setDocResults([]);
      setDocQuery("");
      setShowAddDocs(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to attach documents");
    } finally {
      setBusy(null);
    }
  }

  async function detachDoc(documentId: string) {
    if (!confirm("Detach this document from the matter? If no other open matter holds it, the legal hold flag will be cleared.")) return;
    setBusy(`detach:${documentId}`);
    try {
      await fetch(`/api/admin/matters/${id}/documents?documentId=${encodeURIComponent(documentId)}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sendNotices(opts: { force?: boolean; custodianId?: string } = {}) {
    setBusy("sendNotices");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/admin/matters/${id}/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send notices");
      setInfo(
        `Sent ${data.sent} / ${data.total}, skipped ${data.skipped}, failed ${data.failed}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send notices");
    } finally {
      setBusy(null);
    }
  }

  async function closeOrReopen() {
    if (!matter) return;
    const next = matter.status === "OPEN" ? "CLOSED" : "OPEN";
    const verb = next === "CLOSED" ? "Close" : "Reopen";
    if (!confirm(`${verb} this matter? Documents will have their hold state recomputed.`)) return;
    setBusy("status");
    try {
      const res = await fetch(`/api/admin/matters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage")) return <div className="p-6 text-red-600">Forbidden</div>;
  if (loading || !matter) {
    return <div className="p-6 text-gray-500">Loading matter…</div>;
  }

  const ackedCount = matter.custodians.filter((c) => c.notice?.acknowledgedAt).length;
  const sentCount = matter.custodians.filter((c) => c.notice).length;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in max-w-6xl">
      <Link href="/admin/matters" className="text-sm text-gray-500 hover:text-[#02773b]">
        ← All matters
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-gray-500">{matter.matterNumber}</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{matter.name}</h1>
          {matter.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 max-w-3xl whitespace-pre-wrap">
              {matter.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            <span>Opened {new Date(matter.openedAt).toLocaleString()}</span>
            {matter.closedAt && <span>· Closed {new Date(matter.closedAt).toLocaleString()}</span>}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                matter.status === "OPEN"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {matter.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={closeOrReopen}
            disabled={busy === "status"}
            className="h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {matter.status === "OPEN" ? "Close matter" : "Reopen matter"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          {info}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Custodians", value: matter.custodians.length },
          { label: "Documents", value: matter.documents.length },
          { label: "Notices sent", value: sentCount },
          { label: "Acknowledged", value: ackedCount },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-center"
          >
            <p className="text-2xl font-bold text-[#02773b]">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Custodians */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Custodians</h2>
          <div className="flex gap-2">
            <button
              onClick={() => sendNotices()}
              disabled={busy === "sendNotices" || matter.status !== "OPEN" || matter.custodians.length === 0}
              className="h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] disabled:opacity-60"
            >
              {busy === "sendNotices" ? "Sending…" : "Send pending notices"}
            </button>
            <button
              onClick={() => setShowAddCustodian((v) => !v)}
              disabled={matter.status !== "OPEN"}
              className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
            >
              {showAddCustodian ? "Cancel" : "Add custodian"}
            </button>
          </div>
        </div>

        {showAddCustodian && (
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 space-y-3">
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={custodianMode === "internal"}
                  onChange={() => setCustodianMode("internal")}
                />
                Internal user
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={custodianMode === "external"}
                  onChange={() => setCustodianMode("external")}
                />
                External
              </label>
            </div>
            {custodianMode === "internal" ? (
              <div>
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search users by name or email…"
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
                />
                {userResults.length > 0 && (
                  <ul className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 max-h-56 overflow-y-auto bg-white dark:bg-gray-800">
                    {userResults.map((u) => (
                      <li key={u.id}>
                        <button
                          onClick={() => addInternalCustodian(u)}
                          disabled={busy === "addCustodian"}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {u.displayName ?? u.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {u.email}
                            {u.department ? ` · ${u.department}` : ""}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <input
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="Name (optional)"
                  className="h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
                />
                <div className="flex gap-2">
                  <input
                    value={extEmail}
                    onChange={(e) => setExtEmail(e.target.value)}
                    placeholder="email@example.com"
                    type="email"
                    className="flex-1 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
                  />
                  <button
                    onClick={addExternalCustodian}
                    disabled={busy === "addCustodian" || !extEmail.trim()}
                    className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {matter.custodians.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No custodians yet.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Custodian</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Notice</th>
                <th className="px-4 py-2 text-left">Acknowledged</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {matter.custodians.map((c) => {
                const name = c.user
                  ? c.user.displayName ?? c.user.name
                  : c.externalName ?? c.externalEmail ?? "Unnamed";
                const email = c.user?.email ?? c.externalEmail ?? "";
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{name}</div>
                      <div className="text-xs text-gray-500">{email}</div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.user ? (
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                          internal
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          external
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {c.notice ? new Date(c.notice.sentAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.notice?.acknowledgedAt ? (
                        <span className="text-emerald-600">
                          {new Date(c.notice.acknowledgedAt).toLocaleString()}
                        </span>
                      ) : c.notice ? (
                        <span className="text-amber-600">pending</span>
                      ) : (
                        <span className="text-gray-400">no notice</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs">
                      <button
                        onClick={() => sendNotices({ custodianId: c.id, force: true })}
                        disabled={busy === "sendNotices" || matter.status !== "OPEN"}
                        className="text-[#02773b] hover:underline disabled:opacity-50"
                      >
                        {c.notice ? "Resend" : "Send"}
                      </button>
                      <span className="mx-2 text-gray-300">·</span>
                      <button
                        onClick={() => removeCustodian(c.id)}
                        disabled={busy === `removeCust:${c.id}`}
                        className="text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Documents */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Documents on hold</h2>
          <button
            onClick={() => setShowAddDocs((v) => !v)}
            disabled={matter.status !== "OPEN"}
            className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
          >
            {showAddDocs ? "Cancel" : "Attach documents"}
          </button>
        </div>

        {showAddDocs && (
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 space-y-3">
            <input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder="Search documents by title or reference…"
              className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm outline-none focus:border-[#02773b]"
            />
            {docResults.length > 0 && (
              <ul className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 max-h-72 overflow-y-auto bg-white dark:bg-gray-800">
                {docResults.map((d) => {
                  const selected = selectedDocs.has(d.id);
                  return (
                    <li key={d.id}>
                      <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) =>
                            setSelectedDocs((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(d.id);
                              else next.delete(d.id);
                              return next;
                            })
                          }
                        />
                        <span className="flex-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{d.title}</span>
                          <span className="ml-2 text-xs font-mono text-gray-500">{d.referenceNumber}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                onClick={attachSelectedDocs}
                disabled={busy === "attachDocs" || selectedDocs.size === 0}
                className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60"
              >
                {busy === "attachDocs" ? "Attaching…" : `Attach ${selectedDocs.size} document(s)`}
              </button>
            </div>
          </div>
        )}

        {matter.documents.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No documents attached yet.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Document</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Attached</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {matter.documents.map((row) => (
                <tr key={row.documentId}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/documents/${row.documentId}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-[#02773b]"
                    >
                      {row.document.title}
                    </Link>
                    <div className="text-xs font-mono text-gray-500">{row.document.referenceNumber}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">{row.document.documentType}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(row.addedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    <button
                      onClick={() => detachDoc(row.documentId)}
                      disabled={busy === `detach:${row.documentId}` || matter.status !== "OPEN"}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Detach
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
