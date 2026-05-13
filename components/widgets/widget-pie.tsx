"use client";

import type { Widget, DashboardData, Breakdown } from "@/lib/widgets";
import { resolveDataKey } from "@/lib/widgets";

const SLICE_COLORS = [
  "#0d9b6c", // karu-green
  "#f5b400",
  "#3b82f6",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#ec4899",
];

/**
 * Hand-drawn SVG pie chart — no chart library. Slices are computed as
 * cumulative arcs and rendered as `<path>` elements. Empty/zero data
 * shows an empty ring rather than an exception.
 */
export default function WidgetPie({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  const raw = data ? resolveDataKey(data, widget.config.dataKey) : undefined;
  const rows = (Array.isArray(raw) ? raw : []) as Breakdown[];
  const total = rows.reduce((s, r) => s + r.count, 0);

  // Geometry — radius 40 in a 100-unit viewBox keeps maths simple.
  const cx = 50;
  const cy = 50;
  const r = 40;

  let cursor = 0;
  const slices = rows.map((row, i) => {
    const frac = total > 0 ? row.count / total : 0;
    const start = cursor;
    const end = cursor + frac;
    cursor = end;
    return {
      key: row.key,
      count: row.count,
      color: SLICE_COLORS[i % SLICE_COLORS.length],
      d: arcPath(cx, cy, r, start, end),
    };
  });

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {widget.title}
      </div>
      <div className="flex flex-1 items-center gap-3 min-h-0">
        <svg
          viewBox="0 0 100 100"
          className="h-full max-h-40 w-auto shrink-0"
          role="img"
          aria-label={widget.title}
        >
          {total === 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={6}
            />
          ) : slices.length === 1 ? (
            <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
          ) : (
            slices.map((s) => <path key={s.key} d={s.d} fill={s.color} />)
          )}
        </svg>
        <ul className="flex-1 overflow-auto text-xs space-y-0.5 min-w-0">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 truncate">
              <span
                className="inline-block h-2 w-2 rounded-sm shrink-0"
                style={{ background: s.color }}
              />
              <span className="truncate text-gray-700 dark:text-gray-300">
                {s.key}
              </span>
              <span className="ml-auto font-mono text-gray-500 shrink-0">
                {s.count.toLocaleString()}
              </span>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="italic text-gray-400">No data.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Build an SVG path for the arc between two unit fractions (0..1). */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startFrac: number,
  endFrac: number
): string {
  if (endFrac - startFrac >= 0.999) {
    // Full circle — two semicircles avoid the d="M ... A ... A" degenerate case.
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  const a0 = startFrac * 2 * Math.PI - Math.PI / 2;
  const a1 = endFrac * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}
