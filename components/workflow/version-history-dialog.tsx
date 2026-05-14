"use client";

import { useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "reactflow";
import {
  diffWorkflows,
  type WorkflowDiff,
  type NodeFieldChange,
} from "@/lib/workflow-diff";

interface VersionSummary {
  id: string;
  version: number;
  name: string;
  description: string | null;
  publishedAt: string;
  note: string | null;
  publishedBy: { id: string; name: string; displayName: string | null };
}

interface VersionDetail extends VersionSummary {
  definition: { nodes: Node[]; edges: Edge[] };
}

interface VersionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  templateId: string | null;
  /** Current canvas state — what we compare against. */
  currentNodes: Node[];
  currentEdges: Edge[];
  /** Restore action — page swaps the canvas and unpublishes. */
  onRestore: (definition: { nodes: Node[]; edges: Edge[] }, version: number) => Promise<void> | void;
}

export default function VersionHistoryDialog({
  open,
  onClose,
  templateId,
  currentNodes,
  currentEdges,
  onRestore,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VersionDetail | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list whenever the dialog opens.
  useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workflows/templates/${templateId}/versions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { versions: VersionSummary[] }) => {
        if (cancelled) return;
        setVersions(data.versions);
        // Auto-select the newest so users see a diff immediately.
        if (data.versions.length > 0) {
          setSelectedVersion(data.versions[0].version);
        } else {
          setSelectedVersion(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load version history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateId]);

  // Load the full snapshot for the selected version.
  useEffect(() => {
    if (!open || !templateId || selectedVersion === null) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/workflows/templates/${templateId}/versions/${selectedVersion}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { snapshot: VersionDetail }) => {
        if (!cancelled) setSelectedDetail(data.snapshot);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateId, selectedVersion]);

  const diff: WorkflowDiff | null = useMemo(() => {
    if (!selectedDetail) return null;
    return diffWorkflows(
      { nodes: selectedDetail.definition.nodes ?? [], edges: selectedDetail.definition.edges ?? [] },
      { nodes: currentNodes, edges: currentEdges }
    );
  }, [selectedDetail, currentNodes, currentEdges]);

  async function handleRestoreClicked() {
    if (!selectedDetail) return;
    const confirmed = confirm(
      `Restore version ${selectedDetail.version}? The current canvas will be replaced with this snapshot. The template will become a draft until you publish it again.`
    );
    if (!confirmed) return;
    setRestoring(true);
    try {
      await onRestore(
        {
          nodes: selectedDetail.definition.nodes ?? [],
          edges: selectedDetail.definition.edges ?? [],
        },
        selectedDetail.version
      );
      onClose();
    } catch {
      setError("Restore failed.");
    } finally {
      setRestoring(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-[min(960px,95vw)] h-[min(640px,90vh)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Version History
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Snapshots are taken on each publish. Compare to current and roll back if needed.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        {/* Body: list + diff */}
        <div className="flex-1 min-h-0 flex">
          {/* Versions list */}
          <div className="w-64 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
            {loading && (
              <p className="text-xs text-gray-400 px-4 py-3">Loading versions…</p>
            )}
            {!loading && versions.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No published versions yet.
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  Publish the template to start the version history.
                </p>
              </div>
            )}
            {versions.map((v) => {
              const selected = selectedVersion === v.version;
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedVersion(v.version)}
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                    selected
                      ? "bg-karu-green/10 text-[#02773b] dark:text-[#60c988]"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">v{v.version}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {new Date(v.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    by {v.publishedBy.displayName || v.publishedBy.name}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Diff pane */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {!selectedDetail && !loading && (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                Select a version on the left to see what changed.
              </p>
            )}
            {selectedDetail && diff && (
              <DiffView
                detail={selectedDetail}
                diff={diff}
                onRestore={handleRestoreClicked}
                restoring={restoring}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diff view                                                          */
/* ------------------------------------------------------------------ */

function DiffView({
  detail,
  diff,
  onRestore,
  restoring,
}: {
  detail: VersionDetail;
  diff: WorkflowDiff;
  onRestore: () => void;
  restoring: boolean;
}) {
  const { summary } = diff;
  const noChanges =
    summary.nodesAdded === 0 &&
    summary.nodesRemoved === 0 &&
    summary.nodesChanged === 0 &&
    summary.edgesAdded === 0 &&
    summary.edgesRemoved === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Version {detail.version} → Current
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Published {new Date(detail.publishedAt).toLocaleString()} by{" "}
            {detail.publishedBy.displayName || detail.publishedBy.name}
          </p>
        </div>
        <button
          onClick={onRestore}
          disabled={restoring}
          className="h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-semibold hover:bg-[#026332] transition-colors disabled:opacity-60"
        >
          {restoring ? "Restoring…" : "Restore this version"}
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-1.5 text-[11px] font-medium">
        <Chip count={summary.nodesAdded} label="nodes added" tone="green" />
        <Chip count={summary.nodesRemoved} label="nodes removed" tone="red" />
        <Chip count={summary.nodesChanged} label="nodes changed" tone="amber" />
        <Chip count={summary.edgesAdded} label="edges added" tone="green" />
        <Chip count={summary.edgesRemoved} label="edges removed" tone="red" />
      </div>

      {noChanges && (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          Current canvas matches this version exactly.
        </p>
      )}

      {/* Added nodes */}
      {diff.addedNodes.length > 0 && (
        <Section title="Added nodes" tone="green">
          {diff.addedNodes.map((n) => (
            <li key={n.id} className="text-xs">
              <strong>{(n.data?.label as string) || n.type}</strong>{" "}
              <span className="text-gray-400">({n.type})</span>
            </li>
          ))}
        </Section>
      )}

      {/* Removed nodes */}
      {diff.removedNodes.length > 0 && (
        <Section title="Removed nodes" tone="red">
          {diff.removedNodes.map((n) => (
            <li key={n.id} className="text-xs">
              <strong>{(n.data?.label as string) || n.type}</strong>{" "}
              <span className="text-gray-400">({n.type})</span>
            </li>
          ))}
        </Section>
      )}

      {/* Changed nodes */}
      {diff.changedNodes.length > 0 && (
        <Section title="Changed nodes" tone="amber">
          {diff.changedNodes.map((c) => (
            <li key={c.id} className="text-xs space-y-1">
              <div>
                <strong>{c.label}</strong>{" "}
                <span className="text-gray-400">({c.type})</span>
              </div>
              <ul className="ml-3 space-y-0.5">
                {c.fields.map((f) => (
                  <FieldChangeRow key={f.field} change={f} />
                ))}
              </ul>
            </li>
          ))}
        </Section>
      )}

      {/* Added edges */}
      {diff.addedEdges.length > 0 && (
        <Section title="Added connections" tone="green">
          {diff.addedEdges.map((e) => (
            <li key={e.id} className="text-xs">
              {e.sourceLabel} <span className="text-gray-400">→</span> {e.targetLabel}
            </li>
          ))}
        </Section>
      )}

      {/* Removed edges */}
      {diff.removedEdges.length > 0 && (
        <Section title="Removed connections" tone="red">
          {diff.removedEdges.map((e) => (
            <li key={e.id} className="text-xs">
              {e.sourceLabel} <span className="text-gray-400">→</span> {e.targetLabel}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "green" | "red" | "amber";
  children: React.ReactNode;
}) {
  const colour = {
    green: "text-emerald-700 dark:text-emerald-400",
    red: "text-red-700 dark:text-red-400",
    amber: "text-amber-700 dark:text-amber-400",
  }[tone];
  return (
    <div>
      <h4 className={`text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${colour}`}>
        {title}
      </h4>
      <ul className="space-y-1 list-disc list-inside text-gray-700 dark:text-gray-300">
        {children}
      </ul>
    </div>
  );
}

function FieldChangeRow({ change }: { change: NodeFieldChange }) {
  return (
    <li className="text-gray-500 dark:text-gray-400">
      <span className="font-mono text-[10px]">{change.field}</span>:{" "}
      <span className="line-through text-red-600 dark:text-red-400">
        {formatValue(change.before)}
      </span>{" "}
      <span className="text-gray-400">→</span>{" "}
      <span className="text-emerald-700 dark:text-emerald-400">
        {formatValue(change.after)}
      </span>
    </li>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 60 ? j.slice(0, 60) + "…" : j;
  } catch {
    return "[unserialisable]";
  }
}

function Chip({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "green" | "red" | "amber";
}) {
  if (count === 0) return null;
  const cls = {
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    red: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${cls}`}>
      {count} {label}
    </span>
  );
}
