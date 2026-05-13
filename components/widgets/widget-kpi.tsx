"use client";

import type { Widget, DashboardData } from "@/lib/widgets";
import { resolveDataKey } from "@/lib/widgets";

/**
 * Counter plus a delta vs the previous window. The widget assumes the
 * `dataKey` ends in "InWindow" and resolves the matching "PrevWindow"
 * key automatically — for the bundled `documentsCreatedInWindow` this
 * is `documentsCreatedPrevWindow`.
 */
export default function WidgetKpi({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  const path = widget.config.dataKey ?? "";
  const raw = data ? resolveDataKey(data, path) : undefined;
  const prev = data ? resolveDataKey(data, path.replace(/InWindow$/, "PrevWindow")) : undefined;
  const value = typeof raw === "number" ? raw : null;
  const prior = typeof prev === "number" ? prev : null;

  let delta: number | null = null;
  let pct: number | null = null;
  if (value !== null && prior !== null) {
    delta = value - prior;
    pct = prior === 0 ? null : (delta / prior) * 100;
  }

  const arrow = delta === null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "▶";
  const arrowColor =
    delta === null
      ? "text-gray-500"
      : delta > 0
        ? "text-emerald-600"
        : delta < 0
          ? "text-red-600"
          : "text-gray-500";

  return (
    <div className="flex h-full flex-col justify-center px-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {widget.title}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-mono text-gray-900 dark:text-gray-100">
          {value === null ? "—" : value.toLocaleString()}
        </span>
        {widget.config.unit && value !== null && (
          <span className="text-xs text-gray-500">{widget.config.unit}</span>
        )}
      </div>
      {delta !== null && (
        <div className={`mt-1 text-xs font-mono ${arrowColor}`}>
          {arrow} {Math.abs(delta).toLocaleString()}
          {pct !== null && (
            <span className="text-gray-500"> ({pct.toFixed(1)}%)</span>
          )}
          <span className="text-gray-400"> vs previous</span>
        </div>
      )}
    </div>
  );
}
