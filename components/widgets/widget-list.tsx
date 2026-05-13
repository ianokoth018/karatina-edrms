"use client";

import type { Widget, DashboardData } from "@/lib/widgets";
import { resolveDataKey } from "@/lib/widgets";

interface RowLike {
  [k: string]: unknown;
}

/**
 * Top-N list. Auto-detects two known shapes:
 *  - topCreators: { name, count }
 *  - recentDocuments: { title, documentType, createdAt }
 * Falls back to rendering the first two fields of any other array shape.
 */
export default function WidgetList({
  widget,
  data,
}: {
  widget: Widget;
  data: DashboardData | null;
}) {
  const raw = data ? resolveDataKey(data, widget.config.dataKey) : undefined;
  const rows = (Array.isArray(raw) ? raw : []) as RowLike[];
  const limit = Math.max(1, widget.config.limit ?? 8);
  const slice = rows.slice(0, limit);

  // Pick a renderer based on the dataKey rather than runtime shape so we
  // never accidentally render an "id" or other internal field as label.
  const kind =
    widget.config.dataKey === "recentDocuments"
      ? "documents"
      : widget.config.dataKey === "topCreators"
        ? "creators"
        : "generic";

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {widget.title}
      </div>
      <div className="flex-1 overflow-auto rounded border border-gray-200 dark:border-gray-800">
        {slice.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs italic text-gray-400">
            No data.
          </div>
        ) : (
          <table className="min-w-full text-xs">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {slice.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 text-gray-400 font-mono w-6">
                    {i + 1}
                  </td>
                  {kind === "documents" ? (
                    <>
                      <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 truncate">
                        {String(row.title ?? "—")}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap">
                        {String(row.documentType ?? "")}
                      </td>
                    </>
                  ) : kind === "creators" ? (
                    <>
                      <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 truncate">
                        {String(row.name ?? "—")}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300 font-mono">
                        {Number(row.count ?? 0).toLocaleString()}
                      </td>
                    </>
                  ) : (
                    <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 truncate">
                      {JSON.stringify(row)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
