"use client";

import { useEffect, useState } from "react";

interface VersionSummary {
  id: string;
  versionNum: number;
  label: string | null;
  status: string;
  fileName: string | null;
  sizeBytes: string;
  changeNote: string;
  createdAt: string;
}

interface LineDiffChunk {
  type: "equal" | "add" | "del";
  text: string;
}

interface MetadataDiffEntry {
  key: string;
  before: unknown;
  after: unknown;
}

interface CompareResponse {
  v1: VersionSummary;
  v2: VersionSummary;
  lineDiff: LineDiffChunk[];
  metadataDiff: MetadataDiffEntry[];
}

interface VersionDiffViewerProps {
  documentId: string;
  v1Id: string;
  v2Id: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Project the interleaved lineDiff into two parallel column streams so
 * that equal lines line up across columns. `del` rows render an empty
 * cell on the right; `add` rows render an empty cell on the left.
 */
function buildSideBySide(diff: LineDiffChunk[]): Array<{
  left: { type: "equal" | "del"; text: string } | null;
  right: { type: "equal" | "add"; text: string } | null;
}> {
  const rows: Array<{
    left: { type: "equal" | "del"; text: string } | null;
    right: { type: "equal" | "add"; text: string } | null;
  }> = [];
  let i = 0;
  while (i < diff.length) {
    const chunk = diff[i];
    if (chunk.type === "equal") {
      rows.push({
        left: { type: "equal", text: chunk.text },
        right: { type: "equal", text: chunk.text },
      });
      i++;
      continue;
    }
    // Pair adjacent del/add runs so they sit on the same visual row.
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < diff.length && diff[i].type !== "equal") {
      if (diff[i].type === "del") dels.push(diff[i].text);
      else adds.push(diff[i].text);
      i++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) {
      rows.push({
        left: k < dels.length ? { type: "del", text: dels[k] } : null,
        right: k < adds.length ? { type: "add", text: adds[k] } : null,
      });
    }
  }
  return rows;
}

export default function VersionDiffViewer({
  documentId,
  v1Id,
  v2Id,
  onClose,
}: VersionDiffViewerProps) {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/documents/${documentId}/versions/compare?v1=${encodeURIComponent(v1Id)}&v2=${encodeURIComponent(v2Id)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        const json = (await res.json()) as CompareResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load comparison");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [documentId, v1Id, v2Id]);

  const rows = data ? buildSideBySide(data.lineDiff) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version comparison"
        className="relative bg-white dark:bg-gray-900 w-full h-full flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Version comparison
            </h3>
            {data && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-medium">
                    v{data.v1.versionNum}
                    {data.v1.label ? ` · ${data.v1.label}` : ""}
                  </span>
                  <span className="text-gray-400">{formatDate(data.v1.createdAt)}</span>
                </span>
                <span className="mx-2 text-gray-400">vs</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                    v{data.v2.versionNum}
                    {data.v2.label ? ` · ${data.v2.label}` : ""}
                  </span>
                  <span className="text-gray-400">{formatDate(data.v2.createdAt)}</span>
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
              <svg className="w-4 h-4 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading comparison...
            </div>
          )}

          {error && !loading && (
            <div className="m-6 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {data && !loading && !error && (
            <div className="px-6 py-4 space-y-6">
              {/* Side-by-side line diff */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Content
                </h4>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="grid grid-cols-2 text-xs font-medium bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                    <div className="px-4 py-2 border-r border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300">
                      v{data.v1.versionNum} (before)
                    </div>
                    <div className="px-4 py-2 text-gray-600 dark:text-gray-300">
                      v{data.v2.versionNum} (after)
                    </div>
                  </div>
                  {rows.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                      No textual differences.
                    </div>
                  ) : (
                    <div className="font-mono text-xs leading-5 max-h-[55vh] overflow-auto">
                      {rows.map((row, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-2 border-b border-gray-100 dark:border-gray-800/60 last:border-b-0"
                        >
                          <div
                            className={`px-4 py-1 border-r border-gray-200 dark:border-gray-800 whitespace-pre-wrap break-words ${
                              row.left?.type === "del"
                                ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                                : "text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {row.left ? (row.left.text === "" ? " " : row.left.text) : " "}
                          </div>
                          <div
                            className={`px-4 py-1 whitespace-pre-wrap break-words ${
                              row.right?.type === "add"
                                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                                : "text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {row.right ? (row.right.text === "" ? " " : row.right.text) : " "}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Metadata diff */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Metadata
                </h4>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        <th className="px-4 py-2 border-b border-gray-200 dark:border-gray-800">Field</th>
                        <th className="px-4 py-2 border-b border-gray-200 dark:border-gray-800">
                          v{data.v1.versionNum} (before)
                        </th>
                        <th className="px-4 py-2 border-b border-gray-200 dark:border-gray-800">
                          v{data.v2.versionNum} (after)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.metadataDiff.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500"
                          >
                            No metadata differences.
                          </td>
                        </tr>
                      ) : (
                        data.metadataDiff.map((row) => (
                          <tr key={row.key}>
                            <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100 align-top">
                              {row.key}
                            </td>
                            <td className="px-4 py-2 align-top">
                              <span className="inline-block px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs break-all">
                                {renderCell(row.before)}
                              </span>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs break-all">
                                {renderCell(row.after)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
