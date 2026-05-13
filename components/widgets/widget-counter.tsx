"use client";

import type { Widget, DashboardData } from "@/lib/widgets";
import { resolveDataKey } from "@/lib/widgets";

/**
 * Big-number widget. Renders the value at `config.dataKey` formatted with
 * thousand separators. If the resolved value isn't a number we degrade to
 * a "—" so a misconfigured widget can't blow up the dashboard.
 */
export default function WidgetCounter({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  const raw = data ? resolveDataKey(data, widget.config.dataKey) : undefined;
  const value = typeof raw === "number" ? raw : null;
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
    </div>
  );
}
