"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  RotateCcw,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface VersionUser {
  id?: string;
  name: string;
  displayName: string;
}

interface VersionRow {
  id: string;
  versionNum: number;
  label: string | null;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "SUPERSEDED" | "REJECTED";
  changeNote: string;
  sizeBytes: string;
  mimeType: string | null;
  fileName: string | null;
  storagePath: string;
  createdAt: string;
  isLatest: boolean;
  createdBy: VersionUser | null;
  approvedBy: VersionUser | null;
  approvedAt: string | null;
  downloadUrl: string;
}

interface LockStatus {
  isCheckedOut: boolean;
  isLockedByCurrentUser: boolean;
  isExpired: boolean;
  checkoutUser: VersionUser | null;
  checkoutAt: string | null;
  checkoutExpiresAt: string | null;
  documentStatus: string;
  latestVersion: { id: string; versionNum: number; status: string; label: string | null } | null;
  pendingReviewCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  DRAFT: { label: "Draft", classes: "bg-gray-100 text-gray-700" },
  IN_REVIEW: { label: "In Review", classes: "bg-yellow-100 text-yellow-800" },
  APPROVED: { label: "Approved", classes: "bg-green-100 text-green-700" },
  SUPERSEDED: { label: "Superseded", classes: "bg-slate-100 text-slate-500" },
  REJECTED: { label: "Rejected", classes: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, classes: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

function formatBytes(bytes: string | number) {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Upload modal
// ---------------------------------------------------------------------------
function UploadVersionModal({
  docId,
  onClose,
  onSuccess,
}: {
  docId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Please select a file"); return; }
    setLoading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("changeNote", changeNote || "New version uploaded");
    const res = await fetch(`/api/documents/${docId}/versions`, { method: "POST", body: fd });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setError(json.error ?? "Upload failed"); return; }
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Upload New Version</h2>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File</label>
            <input
              type="file"
              className="block w-full text-sm border rounded-lg p-2"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Change Note</label>
            <textarea
              className="w-full border rounded-lg p-2 text-sm resize-none"
              rows={3}
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Describe what changed in this version..."
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve/Reject modal
// ---------------------------------------------------------------------------
function ApproveModal({
  docId,
  version,
  onClose,
  onSuccess,
}: {
  docId: string;
  version: VersionRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [action, setAction] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch(`/api/documents/${docId}/versions/${version.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setError(json.error ?? "Failed"); return; }
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Review Version {version.versionNum}</h2>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="action" value="approve" checked={action === "approve"} onChange={() => setAction("approve")} />
              <span className="text-sm font-medium text-green-700">Approve</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="action" value="reject" checked={action === "reject"} onChange={() => setAction("reject")} />
              <span className="text-sm font-medium text-red-700">Reject</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {action === "reject" ? "Rejection Reason *" : "Comment (optional)"}
            </label>
            <textarea
              className="w-full border rounded-lg p-2 text-sm resize-none"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={action === "reject"}
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              type="submit"
              disabled={loading}
              className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
            >
              {loading ? "Saving..." : action === "approve" ? "Approve" : "Reject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function VersionHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [approveVersion, setApproveVersion] = useState<VersionRow | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [actionMsg, setActionMsg] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [vRes, lRes] = await Promise.all([
        fetch(`/api/documents/${id}/versions`),
        fetch(`/api/documents/${id}/lock-status`),
      ]);
      if (!vRes.ok) throw new Error("Failed to load versions");
      const [vData, lData] = await Promise.all([vRes.json(), lRes.ok ? lRes.json() : null]);
      setVersions(vData);
      setLockStatus(lData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSubmitReview(versionId: string) {
    const res = await fetch(`/api/documents/${id}/versions/${versionId}/submit`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) { setActionMsg(json.error ?? "Failed"); return; }
    setActionMsg("Version submitted for review");
    await loadData();
  }

  async function handleRollback(versionId: string, versionNum: number) {
    if (!confirm(`Rollback to version ${versionNum}? This creates a new version copied from v${versionNum}.`)) return;
    const res = await fetch(`/api/documents/${id}/versions/${versionId}/rollback`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) { setActionMsg(json.error ?? "Rollback failed"); return; }
    setActionMsg(json.message ?? "Rollback successful");
    await loadData();
  }

  async function handleForceCheckin() {
    if (!confirm("Force-release the document lock? The current holder will be notified.")) return;
    const res = await fetch(`/api/documents/${id}/checkout/force`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) { setActionMsg(json.error ?? "Failed"); return; }
    setActionMsg("Lock released");
    await loadData();
  }

  function toggleExpand(vId: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(vId) ? n.delete(vId) : n.add(vId);
      return n;
    });
  }

  function toggleSelect(vId: string) {
    setSelected((prev) =>
      prev.includes(vId) ? prev.filter((x) => x !== vId) : [...prev, vId].slice(-2)
    );
  }

  const canCompare = selected.length === 2;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Version History</h1>
          <p className="text-sm text-gray-500">{versions.length} version{versions.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          {canCompare && (
            <Link
              href={`/records/documents/${id}/versions/compare?v1=${selected[0]}&v2=${selected[1]}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
            >
              <Eye className="h-4 w-4" />
              Compare Selected
            </Link>
          )}
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Upload className="h-4 w-4" />
            Upload Version
          </button>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg">
          {actionMsg}
          <button className="ml-2 text-xs underline" onClick={() => setActionMsg("")}>dismiss</button>
        </div>
      )}

      {/* Lock status banner */}
      {lockStatus?.isCheckedOut && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              Document locked by {lockStatus.checkoutUser?.displayName ?? "Unknown"}
            </p>
            {lockStatus.checkoutAt && (
              <p className="text-xs text-amber-600 mt-0.5">Since {formatDate(lockStatus.checkoutAt)}</p>
            )}
            {lockStatus.checkoutExpiresAt && (
              <p className="text-xs text-amber-600">Expires {formatDate(lockStatus.checkoutExpiresAt)}</p>
            )}
          </div>
          <button
            onClick={handleForceCheckin}
            className="text-xs text-amber-700 border border-amber-300 px-2 py-1 rounded hover:bg-amber-100"
          >
            Force Release
          </button>
        </div>
      )}

      {/* Pending review banner */}
      {lockStatus && lockStatus.pendingReviewCount > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          {lockStatus.pendingReviewCount} version{lockStatus.pendingReviewCount > 1 ? "s" : ""} pending review
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Compare hint */}
      {versions.length >= 2 && (
        <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5" />
          Select two versions to compare them side-by-side
        </p>
      )}

      {/* Version timeline */}
      <div className="space-y-3">
        {versions.map((v, idx) => {
          const isExp = expanded.has(v.id);
          const isSel = selected.includes(v.id);

          return (
            <div
              key={v.id}
              className={`rounded-xl border bg-white transition-shadow ${isSel ? "border-blue-400 shadow-md" : "border-gray-200 hover:shadow-sm"}`}
            >
              {/* Row header */}
              <div className="flex items-center gap-3 p-4">
                {/* Select checkbox */}
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  checked={isSel}
                  onChange={() => toggleSelect(v.id)}
                  title="Select for comparison"
                />

                {/* Version badge */}
                <div className="flex flex-col items-center w-10 shrink-0">
                  <span className="text-xs font-bold text-gray-900">v{v.versionNum}</span>
                  {v.isLatest && (
                    <span className="text-[10px] text-blue-600 font-medium">latest</span>
                  )}
                </div>

                {/* Status */}
                <StatusBadge status={v.status} />

                {/* Label */}
                {v.label && (
                  <span className="text-xs text-gray-500 italic">"{v.label}"</span>
                )}

                {/* Change note */}
                <p className="flex-1 text-sm text-gray-700 truncate">{v.changeNote}</p>

                {/* Meta */}
                <div className="hidden sm:flex flex-col items-end text-xs text-gray-500 shrink-0">
                  <span>{v.createdBy?.displayName ?? "Unknown"}</span>
                  <span>{formatDate(v.createdAt)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={v.downloadUrl}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  {v.status === "DRAFT" && (
                    <button
                      onClick={() => handleSubmitReview(v.id)}
                      className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-600"
                      title="Submit for review"
                    >
                      <Clock className="h-4 w-4" />
                    </button>
                  )}
                  {v.status === "IN_REVIEW" && (
                    <button
                      onClick={() => setApproveVersion(v)}
                      className="p-1.5 rounded-lg hover:bg-green-50 text-green-600"
                      title="Approve / Reject"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}
                  {!v.isLatest && idx > 0 && (
                    <button
                      onClick={() => handleRollback(v.id, v.versionNum)}
                      className="p-1.5 rounded-lg hover:bg-orange-50 text-orange-500"
                      title={`Rollback to v${v.versionNum}`}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => toggleExpand(v.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
                  >
                    {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded details */}
              {isExp && (
                <div className="border-t px-4 py-3 bg-gray-50 rounded-b-xl grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">File:</span>{" "}
                    <span className="font-medium">{v.fileName ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Size:</span>{" "}
                    <span className="font-medium">{formatBytes(v.sizeBytes)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">MIME:</span>{" "}
                    <span className="font-medium">{v.mimeType ?? "—"}</span>
                  </div>
                  {v.approvedBy && (
                    <div>
                      <span className="text-gray-500">Approved by:</span>{" "}
                      <span className="font-medium">{v.approvedBy.displayName}</span>
                      {v.approvedAt && (
                        <span className="text-gray-400 ml-1">({formatDate(v.approvedAt)})</span>
                      )}
                    </div>
                  )}
                  {v.status === "REJECTED" && (
                    <div className="col-span-2 flex items-center gap-1 text-red-600">
                      <XCircle className="h-4 w-4" />
                      <span>Rejected — see change note for reason</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {versions.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No versions yet. Upload the first version.</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showUpload && (
        <UploadVersionModal docId={id} onClose={() => setShowUpload(false)} onSuccess={loadData} />
      )}
      {approveVersion && (
        <ApproveModal
          docId={id}
          version={approveVersion}
          onClose={() => setApproveVersion(null)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
