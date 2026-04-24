"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, GitBranch, Minus, Plus, Equal } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DiffChunk {
  type: "equal" | "insert" | "delete";
  lines: string[];
}

interface MetaDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

interface VersionMeta {
  versionNum: number;
  label: string | null;
  status: string;
}

interface CompareResult {
  v1: VersionMeta & { ocrText?: string | null };
  v2: VersionMeta & { ocrText?: string | null };
  diff?: DiffChunk[];
  metaDiff?: MetaDiffEntry[];
}

// ---------------------------------------------------------------------------
// Diff renderer
// ---------------------------------------------------------------------------
function DiffLine({
  chunk,
  lineOffset,
}: {
  chunk: DiffChunk;
  lineOffset: number;
}) {
  const bg =
    chunk.type === "insert"
      ? "bg-green-50"
      : chunk.type === "delete"
      ? "bg-red-50"
      : "bg-white";
  const textColor =
    chunk.type === "insert"
      ? "text-green-800"
      : chunk.type === "delete"
      ? "text-red-700"
      : "text-gray-700";
  const Icon =
    chunk.type === "insert" ? Plus : chunk.type === "delete" ? Minus : Equal;
  const iconColor =
    chunk.type === "insert"
      ? "text-green-500"
      : chunk.type === "delete"
      ? "text-red-500"
      : "text-gray-300";

  return (
    <>
      {chunk.lines.map((line, i) => (
        <tr key={i} className={`${bg} font-mono`}>
          <td className="w-10 select-none text-right text-xs text-gray-400 px-2 py-0.5 border-r border-gray-100">
            {lineOffset + i + 1}
          </td>
          <td className={`w-5 text-center ${iconColor}`}>
            <Icon className="h-3 w-3 inline" />
          </td>
          <td className={`px-2 py-0.5 text-xs whitespace-pre-wrap break-all ${textColor}`}>
            {line}
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function VersionComparePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const v1Id = searchParams.get("v1") ?? "";
  const v2Id = searchParams.get("v2") ?? "";

  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!v1Id || !v2Id) return;
    setLoading(true);
    setError("");
    fetch(`/api/documents/${id}/versions/compare?v1=${v1Id}&v2=${v2Id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setResult(data as CompareResult);
      })
      .catch(() => setError("Failed to load comparison"))
      .finally(() => setLoading(false));
  }, [id, v1Id, v2Id]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Version Comparison</h1>
          {result && (
            <p className="text-sm text-gray-500">
              v{result.v1.versionNum} {result.v1.label ? `"${result.v1.label}"` : ""}{" "}
              <ArrowRight className="h-3.5 w-3.5 inline" />{" "}
              v{result.v2.versionNum} {result.v2.label ? `"${result.v2.label}"` : ""}
            </p>
          )}
        </div>
      </div>

      {!v1Id || !v2Id ? (
        <div className="text-center py-16 text-gray-400">
          <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Select two versions from the history page to compare.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center min-h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : result ? (
        <div className="space-y-6">
          {/* Version summary cards */}
          <div className="grid grid-cols-2 gap-4">
            {[result.v1, result.v2].map((v, i) => (
              <div key={i} className={`p-4 rounded-xl border ${i === 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  {i === 0 ? "Before" : "After"}
                </p>
                <p className="font-semibold text-gray-800">Version {v.versionNum}</p>
                {v.label && <p className="text-xs text-gray-500 italic">"{v.label}"</p>}
                <span className="mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-white border">
                  {v.status}
                </span>
              </div>
            ))}
          </div>

          {/* Meta diff (non-PDF) */}
          {result.metaDiff && result.metaDiff.length > 0 && (
            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b text-sm font-medium text-gray-700">
                Metadata Changes
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left w-32">Field</th>
                    <th className="px-4 py-2 text-left">Before</th>
                    <th className="px-4 py-2 text-left">After</th>
                  </tr>
                </thead>
                <tbody>
                  {result.metaDiff.map((entry, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-4 py-2 font-medium text-gray-600">{entry.field}</td>
                      <td className="px-4 py-2 bg-red-50 text-red-800 font-mono text-xs">
                        {String(entry.before ?? "—")}
                      </td>
                      <td className="px-4 py-2 bg-green-50 text-green-800 font-mono text-xs">
                        {String(entry.after ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Text diff (PDF OCR) */}
          {result.diff && (
            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Text Content Diff</span>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1 text-green-600">
                    <Plus className="h-3 w-3" /> Added
                  </span>
                  <span className="flex items-center gap-1 text-red-600">
                    <Minus className="h-3 w-3" /> Removed
                  </span>
                  <span className="flex items-center gap-1 text-gray-400">
                    <Equal className="h-3 w-3" /> Unchanged
                  </span>
                </div>
              </div>

              {result.diff.length === 0 ||
              result.diff.every((c) => c.type === "equal") ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No text differences found
                </div>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full border-collapse">
                    <tbody>
                      {(() => {
                        let lineCount = 0;
                        return result.diff!.map((chunk, ci) => {
                          const offset = lineCount;
                          lineCount += chunk.lines.length;
                          return (
                            <DiffLine key={ci} chunk={chunk} lineOffset={offset} />
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* No diff data */}
          {!result.diff && (!result.metaDiff || result.metaDiff.length === 0) && (
            <div className="text-center py-16 text-gray-400">
              <Equal className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>The two versions appear identical.</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
