"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/lib/use-permissions";

type DisposalAction = "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW";
type CertStatus = "DRAFT" | "APPROVED" | "EXECUTED" | "NEEDS_REVIEW";

interface DueDoc {
  documentId: string;
  referenceNumber: string;
  title: string;
  department: string;
  retentionExpiresAt: string;
  classificationNodeId: string;
  classificationCode: string;
  retentionScheduleId: string;
  action: DisposalAction;
}

interface DueResp {
  generatedAt: string;
  count: number;
  documents: DueDoc[];
}

interface ApprovedBy {
  id: string;
  displayName: string;
  email: string;
  department: string | null;
}

interface Certificate {
  id: string;
  certificateNo: string;
  status: CertStatus | string;
  disposalDate: string;
  disposalMethod: string;
  documentCount: number;
  documentIds: string[];
  remarks: string | null;
  executedAt: string | null;
  createdAt: string;
  approvedBy: ApprovedBy | null;
  witness: ApprovedBy | null;
}

interface CertsResp {
  certificates: Certificate[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const ACTION_STYLE: Record<DisposalAction, string> = {
  DESTROY: "bg-red-100 text-red-800 border-red-200",
  ARCHIVE_PERMANENT: "bg-blue-100 text-blue-800 border-blue-200",
  REVIEW: "bg-amber-100 text-amber-800 border-amber-200",
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800 border-gray-200",
  APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
  EXECUTED: "bg-green-100 text-green-800 border-green-200",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800 border-amber-200",
};

export default function AdminDispositionPage() {
  const { can, ready } = usePermissions();
  const canSee = can("admin:manage") || can("records:dispose");
  const canExecute = can("admin:manage");

  const [due, setDue] = useState<DueResp | null>(null);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([
        fetch("/api/admin/disposition/due").then((r) => {
          if (!r.ok) throw new Error(`due HTTP ${r.status}`);
          return r.json() as Promise<DueResp>;
        }),
        fetch("/api/admin/disposition/certificates?limit=100").then((r) => {
          if (!r.ok) throw new Error(`certs HTTP ${r.status}`);
          return r.json() as Promise<CertsResp>;
        }),
      ]);
      setDue(d);
      setCerts(c.certificates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !canSee) return;
    loadAll();
  }, [ready, canSee, loadAll]);

  const drafts = useMemo(
    () => certs.filter((c) => c.status === "DRAFT" || c.status === "APPROVED"),
    [certs],
  );
  const history = useMemo(
    () =>
      certs.filter(
        (c) => c.status === "EXECUTED" || c.status === "NEEDS_REVIEW",
      ),
    [certs],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllDue(action: DisposalAction | "ALL") {
    setSelected(() => {
      const next = new Set<string>();
      if (!due) return next;
      for (const d of due.documents) {
        if (action === "ALL" || d.action === action) next.add(d.documentId);
      }
      return next;
    });
  }

  async function proposeCert(action?: DisposalAction) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Pick at least one document first.");
      return;
    }
    setBusyId("propose");
    try {
      const res = await fetch("/api/admin/disposition/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: ids, action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setSelected(new Set());
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to propose");
    } finally {
      setBusyId(null);
    }
  }

  async function approveCert(id: string) {
    if (!confirm("Approve this disposition certificate?")) return;
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/admin/disposition/certificates/${id}/approve`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function executeCert(id: string) {
    if (
      !confirm(
        "Execute this disposition certificate? Documents will be marked DISPOSED/ARCHIVED. This action is audited and cannot be undone.",
      )
    )
      return;
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/admin/disposition/certificates/${id}/execute`,
        { method: "POST" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        disposed?: number;
        archived?: number;
        skipped?: { documentId: string; reason: string }[];
        needsReview?: boolean;
      };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      alert(
        `Executed.\n  Disposed: ${j.disposed ?? 0}\n  Archived: ${j.archived ?? 0}\n  Skipped: ${j.skipped?.length ?? 0}${j.needsReview ? "\n  (marked NEEDS_REVIEW)" : ""}`,
      );
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Execute failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) return <div className="p-6 text-gray-500">Loading&hellip;</div>;
  if (!canSee) return <div className="p-6 text-red-600">Forbidden</div>;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Retention Disposition</h1>
          <p className="mt-1 text-sm text-gray-600">
            Documents whose retention has fallen due, the draft certificates
            grouping them for approval, and the historical record of every
            executed disposition. Legal holds and external locks are honoured —
            those documents are skipped and audited.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* ─── Due now ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Due now {due ? `(${due.count})` : ""}
          </h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => selectAllDue("ALL")}
              className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => selectAllDue("DESTROY")}
              className="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Select DESTROY
            </button>
            <button
              type="button"
              onClick={() => selectAllDue("ARCHIVE_PERMANENT")}
              className="px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              Select ARCHIVE
            </button>
            <button
              type="button"
              onClick={() => selectAllDue("REVIEW")}
              className="px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Select REVIEW
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Dept</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {due && due.documents.length > 0 ? (
                due.documents.map((d) => (
                  <tr key={d.documentId}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(d.documentId)}
                        onChange={() => toggleSelected(d.documentId)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {d.referenceNumber}
                    </td>
                    <td className="px-3 py-2">{d.title}</td>
                    <td className="px-3 py-2 text-gray-600">{d.department}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {d.classificationCode}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(d.retentionExpiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[d.action]}`}
                      >
                        {d.action}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    Nothing due — the worker has no pending work.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => proposeCert()}
            disabled={busyId === "propose" || selected.size === 0}
            className="rounded-md bg-karu-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Propose certificate ({selected.size})
          </button>
        </div>
      </section>

      {/* ─── Draft certificates ─────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Draft &amp; approved certificates ({drafts.length})
        </h2>
        <CertTable
          certs={drafts}
          busyId={busyId}
          onApprove={approveCert}
          onExecute={executeCert}
          canExecute={canExecute}
        />
      </section>

      {/* ─── History ────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Executed history ({history.length})
        </h2>
        <CertTable
          certs={history}
          busyId={busyId}
          onApprove={approveCert}
          onExecute={executeCert}
          canExecute={canExecute}
          readOnly
        />
      </section>
    </div>
  );
}

function CertTable({
  certs,
  busyId,
  onApprove,
  onExecute,
  canExecute,
  readOnly,
}: {
  certs: Certificate[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onExecute: (id: string) => void;
  canExecute: boolean;
  readOnly?: boolean;
}) {
  if (certs.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500">
        No certificates.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Certificate</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Docs</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Approver</th>
            <th className="px-3 py-2">Executed</th>
            {!readOnly && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {certs.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2 font-mono text-xs">{c.certificateNo}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? "bg-gray-100 text-gray-800 border-gray-200"}`}
                >
                  {c.status}
                </span>
              </td>
              <td className="px-3 py-2">{c.documentCount}</td>
              <td className="px-3 py-2 text-gray-600">
                {new Date(c.createdAt).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {c.approvedBy?.displayName ?? "—"}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {c.executedAt ? new Date(c.executedAt).toLocaleString() : "—"}
              </td>
              {!readOnly && (
                <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                  {c.status === "DRAFT" && (
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => onApprove(c.id)}
                      className="rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {c.status === "APPROVED" && canExecute && (
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => onExecute(c.id)}
                      className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Execute
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
