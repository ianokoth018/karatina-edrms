"use client";

/**
 * Visual metadata picker.
 *
 * Lets a user pick metadata values straight off a PDF by clicking + dragging
 * a rectangle over the words they want. The component:
 *
 *   1. Loads pre-computed OcrWord bounding boxes from
 *      /api/documents/[id]/ocr-words.
 *   2. Renders the PDF in an <iframe> with a transparent <canvas> overlay
 *      sized to the iframe (same trick as RedactionCanvas).
 *   3. While dragging, draws a live selection rectangle.
 *   4. On release, finds every OcrWord whose centre falls inside the
 *      selection rectangle (per current page), concatenates their `text`
 *      in reading order, and assigns the resulting string to the currently
 *      selected field.
 *
 * Coords are normalised 0–1 (top-left origin) so they survive zoom/resize
 * and match the rest of the EDRMS canvas overlays.
 */
import { useEffect, useRef, useState } from "react";

export interface VisualPickerField {
  name: string;
  label?: string;
  type?: string;
}

export interface PickedValue {
  text: string;
  /** Normalised 0–1 box on `page`. */
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

interface OcrWordDto {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
}

interface OcrPagePayload {
  page: number;
  words: OcrWordDto[];
}

interface VisualMetadataPickerProps {
  documentId: string;
  pdfUrl: string;
  fields: VisualPickerField[];
  /** Initial values keyed by field name (lets the picker hydrate). */
  initialValues?: Record<string, PickedValue>;
  onSave: (values: Record<string, PickedValue>) => Promise<void>;
  onCancel: () => void;
}

export default function VisualMetadataPicker({
  documentId,
  pdfUrl,
  fields,
  initialValues,
  onSave,
  onCancel,
}: VisualMetadataPickerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [liveRect, setLiveRect] = useState<
    { x: number; y: number; width: number; height: number } | null
  >(null);
  const [pages, setPages] = useState<OcrPagePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<string>(
    fields[0]?.name ?? "",
  );
  const [values, setValues] = useState<Record<string, PickedValue>>(
    initialValues ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Load OCR words once. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/documents/${encodeURIComponent(documentId)}/ocr-words`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Failed to load OCR words (${r.status})`);
        }
        const body = (await r.json()) as { pages: OcrPagePayload[] };
        if (cancelled) return;
        setPages(body.pages ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  /* Resize observer — overlay scales with the iframe wrapper. */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => {
      const r = wrapper.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(wrapper);
    const r = wrapper.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, []);

  function eventToLocal(e: React.PointerEvent<HTMLDivElement>) {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const r = wrapper.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !activeField) return;
    const local = eventToLocal(e);
    if (!local) return;
    dragStartRef.current = local;
    setLiveRect({ x: local.x, y: local.y, width: 0, height: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const local = eventToLocal(e);
    if (!local) return;
    const x = Math.min(start.x, local.x);
    const y = Math.min(start.y, local.y);
    const width = Math.abs(local.x - start.x);
    const height = Math.abs(local.y - start.y);
    setLiveRect({ x, y, width, height });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || !liveRect) {
      setLiveRect(null);
      return;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (liveRect.width < 5 || liveRect.height < 5) {
      setLiveRect(null);
      return;
    }
    const W = size.width || 1;
    const H = size.height || 1;
    const nx = liveRect.x / W;
    const ny = liveRect.y / H;
    const nw = liveRect.width / W;
    const nh = liveRect.height / H;
    setLiveRect(null);

    if (!activeField) return;

    // Collect OcrWords whose centre falls inside the selection.
    const pageWords =
      pages.find((p) => p.page === currentPage)?.words ?? [];
    const inside = pageWords.filter((w) => {
      const cx = w.x + w.width / 2;
      const cy = w.y + w.height / 2;
      return cx >= nx && cx <= nx + nw && cy >= ny && cy <= ny + nh;
    });
    // Sort top-to-bottom then left-to-right so multi-line picks read naturally.
    inside.sort((a, b) => {
      // Group rows whose vertical centres are within half a word height.
      const ay = a.y + a.height / 2;
      const by = b.y + b.height / 2;
      const tol = Math.max(a.height, b.height) * 0.6;
      if (Math.abs(ay - by) > tol) return ay - by;
      return a.x - b.x;
    });
    const text = inside.map((w) => w.text).join(" ").trim();
    if (!text) return;

    setValues((prev) => ({
      ...prev,
      [activeField]: {
        text,
        x: nx,
        y: ny,
        width: nw,
        height: nh,
        page: currentPage,
      },
    }));
  }

  function clearField(name: string) {
    setValues((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /* The rectangle currently saved for the active field, if any (on this page). */
  const activeFieldValue = activeField ? values[activeField] : undefined;
  const allValuesOnPage = Object.entries(values).filter(
    ([, v]) => v.page === currentPage,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick metadata visually"
        className="relative bg-white dark:bg-gray-900 w-full h-full flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Pick metadata from the document
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Select a field on the right, then drag a box around the words on
              the document. The picker concatenates matching OCR words.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Page
            </label>
            <input
              type="number"
              min={1}
              value={currentPage}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n >= 1) setCurrentPage(n);
              }}
              className="h-8 w-16 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || Object.keys(values).length === 0}
            className="h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : `Save ${Object.keys(values).length} field${
                  Object.keys(values).length === 1 ? "" : "s"
                }`}
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {/* Left: viewer + overlay */}
          <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 p-4 min-w-0">
            <div
              ref={wrapperRef}
              className="relative mx-auto bg-white shadow rounded overflow-hidden select-none"
              style={{
                width: "min(100%, 1100px)",
                height: "calc(100vh - 10rem)",
                touchAction: "none",
                cursor: activeField ? "crosshair" : "not-allowed",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <iframe
                src={pdfUrl}
                title="PDF for metadata picking"
                className="w-full h-full border-0 pointer-events-none"
              />

              {/* Saved selections on this page (other fields, semi-faded). */}
              {allValuesOnPage.map(([name, v]) => {
                const isActive = name === activeField;
                return (
                  <div
                    key={name}
                    className={
                      "absolute border-2 " +
                      (isActive
                        ? "border-karu-green bg-karu-green/20"
                        : "border-blue-400 bg-blue-300/15")
                    }
                    style={{
                      left: v.x * size.width,
                      top: v.y * size.height,
                      width: v.width * size.width,
                      height: v.height * size.height,
                    }}
                  >
                    <div
                      className={
                        "absolute -top-5 left-0 text-[10px] px-1 py-0.5 rounded-sm font-medium " +
                        (isActive
                          ? "bg-karu-green text-white"
                          : "bg-blue-500 text-white")
                      }
                    >
                      {fields.find((f) => f.name === name)?.label ?? name}
                    </div>
                  </div>
                );
              })}

              {/* In-progress drag rectangle. */}
              {liveRect && (
                <div
                  className="absolute bg-karu-green/20 border-2 border-karu-green pointer-events-none"
                  style={{
                    left: liveRect.x,
                    top: liveRect.y,
                    width: liveRect.width,
                    height: liveRect.height,
                  }}
                />
              )}
            </div>

            {loading && (
              <div className="mx-auto mt-3 max-w-[1100px] text-xs text-gray-500 dark:text-gray-400">
                Loading OCR words…
              </div>
            )}
            {!loading && loadError && (
              <div className="mx-auto mt-3 max-w-[1100px] rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                {loadError}
              </div>
            )}
            {!loading && !loadError && pages.length === 0 && (
              <div className="mx-auto mt-3 max-w-[1100px] text-xs text-gray-500 dark:text-gray-400">
                No OCR words available — run OCR on this document first.
              </div>
            )}
          </div>

          {/* Right: field list */}
          <aside className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Fields
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Pick a field, then drag a box on the document.
              </p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {fields.map((f) => {
                const v = values[f.name];
                const isActive = f.name === activeField;
                return (
                  <div
                    key={f.name}
                    className={
                      "rounded-lg border p-2.5 space-y-1.5 cursor-pointer transition-colors " +
                      (isActive
                        ? "border-karu-green bg-karu-green-light/40 dark:bg-karu-green/10"
                        : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40")
                    }
                    onClick={() => setActiveField(f.name)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                        {f.label ?? f.name}
                      </span>
                      {f.type && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-400">
                          {f.type}
                        </span>
                      )}
                    </div>
                    {v ? (
                      <>
                        <div className="text-xs text-gray-700 dark:text-gray-300 break-words">
                          {v.text}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                          <span>
                            page {v.page} · {Math.round(v.width * 100)}% wide
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearField(f.name);
                            }}
                            className="text-red-500 hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                        Not picked yet
                      </div>
                    )}
                  </div>
                );
              })}
              {fields.length === 0 && (
                <div className="text-xs text-gray-500 dark:text-gray-400 py-6 text-center">
                  No fields to pick.
                </div>
              )}
            </div>
            {activeFieldValue && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
                Current pick (
                {fields.find((f) => f.name === activeField)?.label ??
                  activeField}
                ): page {activeFieldValue.page}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
