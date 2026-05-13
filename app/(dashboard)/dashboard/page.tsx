"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WidgetRenderer from "@/components/widgets";
import {
  DEFAULT_WIDGETS,
  WIDGET_CATALOGUE,
  getWidgetType,
} from "@/lib/widgets";
import type {
  DashboardData,
  Widget,
  WidgetType,
} from "@/lib/widgets";

const GRID_COLS = 12;
const MIN_ROW_PX = 60; // height of one grid row
const MIN_CELL_W = 1;
const MIN_CELL_H = 2;

type DragMode =
  | { kind: "idle" }
  | {
      kind: "move";
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      cellW: number;
    }
  | {
      kind: "resize";
      id: string;
      startX: number;
      startY: number;
      origW: number;
      origH: number;
      cellW: number;
    };

/**
 * Per-user customisable dashboard. Renders a 12-column CSS grid; in edit
 * mode each widget can be moved (drag handle, top-right) or resized
 * (handle, bottom-right corner) using plain pointer events. Layout is
 * persisted to /api/dashboard/layout with a 1s debounce.
 */
export default function DashboardPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [days, setDays] = useState(30);
  const [edit, setEdit] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load layout once on mount.
  useEffect(() => {
    fetch("/api/dashboard/layout")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ widgets: Widget[] }>;
      })
      .then((j) => setWidgets(j.widgets.length ? j.widgets : DEFAULT_WIDGETS))
      .catch(() => setWidgets(DEFAULT_WIDGETS))
      .finally(() => setLoaded(true));
  }, []);

  // Fetch data when days change. Browser cache covers 60s automatically.
  useEffect(() => {
    setError(null);
    fetch(`/api/dashboard/data?sinceDays=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Fetch failed"));
  }, [days]);

  // Debounced save — fires 1s after any layout mutation, but only once
  // the initial load has completed so we don't immediately overwrite
  // the server copy with DEFAULT_WIDGETS for first-time users.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets }),
      }).catch(() => {
        /* swallow — next change retries */
      });
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [widgets, loaded]);

  // -- Drag/resize state. We store coords in pixels relative to the
  // pointer-down event and convert deltas to cell counts on each move.
  const dragRef = useRef<DragMode>({ kind: "idle" });
  const gridRef = useRef<HTMLDivElement | null>(null);

  /** Returns the pixel width of one grid column, accounting for gaps. */
  const measureCellWidth = useCallback(() => {
    const el = gridRef.current;
    if (!el) return 60;
    const styles = getComputedStyle(el);
    const gap = parseFloat(styles.columnGap || "0");
    const totalGap = gap * (GRID_COLS - 1);
    return (el.clientWidth - totalGap) / GRID_COLS;
  }, []);

  const onPointerDown = (
    e: React.PointerEvent,
    id: string,
    kind: "move" | "resize"
  ) => {
    if (!edit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const w = widgets.find((x) => x.id === id);
    if (!w) return;
    const cellW = measureCellWidth();
    if (kind === "move") {
      dragRef.current = {
        kind: "move",
        id,
        startX: e.clientX,
        startY: e.clientY,
        origX: w.x,
        origY: w.y,
        cellW,
      };
    } else {
      dragRef.current = {
        kind: "resize",
        id,
        startX: e.clientX,
        startY: e.clientY,
        origW: w.w,
        origH: w.h,
        cellW,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.kind === "idle") return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const dCol = Math.round(dx / d.cellW);
    const dRow = Math.round(dy / MIN_ROW_PX);
    setWidgets((prev) =>
      prev.map((w) => {
        if (w.id !== d.id) return w;
        if (d.kind === "move") {
          const nx = clamp(d.origX + dCol, 0, GRID_COLS - w.w);
          const ny = Math.max(0, d.origY + dRow);
          if (nx === w.x && ny === w.y) return w;
          return { ...w, x: nx, y: ny };
        }
        // resize
        const nw = clamp(d.origW + dCol, MIN_CELL_W, GRID_COLS - w.x);
        const nh = Math.max(MIN_CELL_H, d.origH + dRow);
        if (nw === w.w && nh === w.h) return w;
        return { ...w, w: nw, h: nh };
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = { kind: "idle" };
  };

  const removeWidget = (id: string) =>
    setWidgets((prev) => prev.filter((w) => w.id !== id));

  const addWidget = (type: WidgetType) => {
    const id = `w-${type.type}-${Date.now().toString(36)}`;
    // Find the lowest free y to place the new widget so it lands below
    // the existing layout rather than on top of it.
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const defaultKey = type.dataKeys[0];
    setWidgets((prev) => [
      ...prev,
      {
        id,
        type: type.type,
        title: type.name,
        x: 0,
        y: maxY,
        w: type.defaultSize.w,
        h: type.defaultSize.h,
        config: defaultKey ? { dataKey: defaultKey } : {},
      },
    ]);
    setShowCatalogue(false);
  };

  const sorted = useMemo(
    () =>
      [...widgets].sort(
        (a, b) => a.y * 1000 + a.x - (b.y * 1000 + b.x)
      ),
    [widgets]
  );

  // Compute the row count needed so the grid never auto-collapses below
  // the lowest widget. +1 padding row in edit mode for breathing space.
  const rowCount = useMemo(() => {
    const max = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    return Math.max(8, max + (edit ? 2 : 0));
  }, [widgets, edit]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Drag widgets to rearrange. Resize from the bottom-right corner.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          {edit && (
            <button
              type="button"
              onClick={() => setShowCatalogue(true)}
              className="rounded-md bg-karu-green px-3 py-1.5 text-sm font-medium text-white hover:bg-karu-green-dark"
            >
              + Add widget
            </button>
          )}
          <button
            type="button"
            onClick={() => setEdit((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              edit
                ? "border-karu-green bg-karu-green-light text-karu-green-dark"
                : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
            }`}
            aria-pressed={edit}
          >
            {edit ? "Done editing" : "Edit layout"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div
        ref={gridRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`grid gap-3 ${
          edit
            ? "bg-[length:calc(100%/12)_60px] bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] rounded-md"
            : ""
        }`}
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gridAutoRows: `${MIN_ROW_PX}px`,
          gridTemplateRows: `repeat(${rowCount}, ${MIN_ROW_PX}px)`,
          touchAction: edit ? "none" : "auto",
        }}
      >
        {sorted.map((w) => (
          <div
            key={w.id}
            className={`relative rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-800 shadow-sm overflow-hidden ${
              edit
                ? "border-karu-green/40 ring-1 ring-karu-green/20"
                : "border-gray-200"
            }`}
            style={{
              gridColumn: `${w.x + 1} / span ${w.w}`,
              gridRow: `${w.y + 1} / span ${w.h}`,
            }}
          >
            <WidgetRenderer widget={w} data={data} />

            {edit && (
              <>
                {/* Drag handle (top-right pill) */}
                <button
                  type="button"
                  onPointerDown={(e) => onPointerDown(e, w.id, "move")}
                  className="absolute right-2 top-2 cursor-grab active:cursor-grabbing rounded-full bg-gray-900/70 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-gray-900"
                  aria-label="Drag widget"
                >
                  ⋮⋮ drag
                </button>
                {/* Delete */}
                <button
                  type="button"
                  onClick={() => removeWidget(w.id)}
                  className="absolute left-2 top-2 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
                  aria-label="Remove widget"
                >
                  ✕
                </button>
                {/* Resize handle (bottom-right) */}
                <div
                  onPointerDown={(e) => onPointerDown(e, w.id, "resize")}
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-karu-green/70"
                  style={{
                    clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
                  }}
                  aria-label="Resize widget"
                />
              </>
            )}
          </div>
        ))}
      </div>

      {showCatalogue && (
        <CatalogueModal
          onClose={() => setShowCatalogue(false)}
          onPick={addWidget}
        />
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function CatalogueModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (type: WidgetType) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white dark:bg-gray-900 dark:border dark:border-gray-800 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a widget</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WIDGET_CATALOGUE.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => onPick(t)}
              className="rounded-md border border-gray-200 dark:border-gray-800 p-3 text-left hover:border-karu-green hover:bg-karu-green-light/40 dark:hover:bg-karu-green/10"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t.name}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {t.description}
              </div>
              <div className="mt-1 text-[10px] text-gray-400 font-mono">
                {t.defaultSize.w}×{t.defaultSize.h}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// `getWidgetType` is intentionally not referenced in this file but is
// re-exported so the catalogue stays the single source of widget metadata.
void getWidgetType;
