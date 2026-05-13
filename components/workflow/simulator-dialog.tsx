"use client";

import { useMemo, useState } from "react";
import type { Node, Edge } from "reactflow";

interface SimulatorDialogProps {
  open: boolean;
  onClose: () => void;
  nodes: Node[];
  edges: Edge[];
}

interface TraceStep {
  nodeId: string;
  nodeType: string;
  label: string;
  detail: string;
  handle?: string;
  varsChanged?: Record<string, unknown>;
  blocked?: boolean;
  skipped?: boolean;
}

interface SimulationResult {
  ok: boolean;
  steps: TraceStep[];
  finalData: Record<string, unknown>;
  terminator: string;
  warnings: string[];
}

/**
 * Dry-run modal — lets a designer feed sample form data into the current
 * workflow and inspect which path the engine would take. No DB writes,
 * no emails, no HTTP calls; tasks and signals are logged as "would block".
 */
export default function SimulatorDialog({
  open,
  onClose,
  nodes,
  edges,
}: SimulatorDialogProps) {
  const [formDataJson, setFormDataJson] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entryFormFields = useMemo(() => {
    const start = nodes.find((n) => n.type === "start");
    const fields = (
      start?.data as {
        variableDefaults?: { name: string }[];
      }
    )?.variableDefaults?.map((d) => d.name) ?? [];
    return fields;
  }, [nodes]);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    let formData: Record<string, unknown> = {};
    try {
      formData = JSON.parse(formDataJson || "{}");
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : "parse error"}`);
      setRunning(false);
      return;
    }
    try {
      const res = await fetch("/api/workflows/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: {
            nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? "", data: n.data })),
            edges: edges.map((e) => ({
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
            })),
          },
          formData,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as SimulationResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Simulate workflow"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Test workflow (dry-run)
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Walks the graph using sample data — no tasks created, no
              emails sent, no APIs called.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="grid flex-1 grid-cols-2 gap-4 overflow-hidden px-5 py-4">
          {/* Left: input */}
          <div className="flex flex-col overflow-hidden">
            <label className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Sample form data (JSON)
            </label>
            <textarea
              value={formDataJson}
              onChange={(e) => setFormDataJson(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none rounded-md border border-gray-300 bg-white p-2 font-mono text-xs text-gray-900 outline-none focus:border-karu-green dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              placeholder='{ "amount": 5000, "department": "Finance" }'
            />
            {entryFormFields.length > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">
                Start-node defaults: {entryFormFields.join(", ")}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={run}
                disabled={running}
                className="rounded-md bg-karu-green px-3 py-1.5 text-xs font-medium text-white hover:bg-karu-green-dark disabled:opacity-60"
              >
                {running ? "Running…" : "Run simulation"}
              </button>
              {error && (
                <span className="text-xs text-red-600">{error}</span>
              )}
            </div>
          </div>

          {/* Right: result */}
          <div className="flex flex-col overflow-hidden">
            <label className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Trace
            </label>
            <div className="flex-1 overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
              {!result ? (
                <div className="flex h-full items-center justify-center p-4 text-xs text-gray-400">
                  Run a simulation to see the trace here.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  <div
                    className={`px-3 py-2 text-xs font-semibold ${
                      result.ok
                        ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    }`}
                  >
                    {result.ok ? "✓ " : "⚠ "}
                    {result.terminator === "end"
                      ? "Reached end node"
                      : result.terminator === "wait_signal"
                        ? "Stopped at signal"
                        : result.terminator === "dangling"
                          ? "Stopped — node has no outgoing edge"
                          : result.terminator === "step_limit"
                            ? "Step limit hit"
                            : result.terminator}
                  </div>
                  {result.warnings.length > 0 && (
                    <ul className="bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                      {result.warnings.map((w, i) => (
                        <li key={i}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                  <ol className="space-y-0">
                    {result.steps.map((s, i) => (
                      <li
                        key={i}
                        className="flex gap-2 px-3 py-2 text-xs"
                      >
                        <span className="w-6 shrink-0 text-right font-mono text-gray-400">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-gray-100 px-1 font-mono text-[10px] uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {s.nodeType}
                            </span>
                            <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                              {s.label}
                            </span>
                            {s.handle && (
                              <span className="rounded bg-blue-50 px-1 font-mono text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                ←{s.handle}
                              </span>
                            )}
                            {s.blocked && (
                              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">
                                BLOCK
                              </span>
                            )}
                            {s.skipped && (
                              <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600 dark:bg-gray-800">
                                skipped
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-gray-600 dark:text-gray-400">
                            {s.detail}
                          </p>
                          {s.varsChanged &&
                            Object.keys(s.varsChanged).length > 0 && (
                              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 px-2 py-1 text-[10px] font-mono text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                {JSON.stringify(s.varsChanged, null, 0)}
                              </pre>
                            )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <details className="px-3 py-2 text-[11px]">
                    <summary className="cursor-pointer text-gray-500">
                      Final variables
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 font-mono text-[10px] dark:bg-gray-800">
                      {JSON.stringify(result.finalData, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
