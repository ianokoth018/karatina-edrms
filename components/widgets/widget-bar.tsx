"use client";

import type { Widget, DashboardData, Breakdown } from "@/lib/widgets";
import { resolveDataKey } from "@/lib/widgets";

/**
 * Horizontal bar chart, reusing the technique from the existing
 * /admin/reports page — no chart library, just Tailwind div widths.
 */
export default function WidgetBar({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  const raw = data ? resolveDataKey(data, widget.config.dataKey) : undefined;
  const rows = (Array.isArray(raw) ? raw : []) as Breakdown[];
  const max = rows.length ? Math.max(...rows.map((r) => r.count), 1) : 1;

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {widget.title}
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs italic text-gray-400">
            No data.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => {
              const pct = Math.max(2, Math.round((r.count / max) * 100));
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 py-1.5"
                >
                  <div className="truncate text-xs text-gray-700 dark:text-gray-300">
                    {r.key}
                  </div>
                  <div className="h-2 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded bg-karu-green"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-right text-xs font-mono text-gray-700 dark:text-gray-300">
                    {r.count.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
