"use client";

/**
 * Visual redaction tool.
 *
 * Coordinate scheme: normalised 0–1 relative to each PDF page. The user draws
 * pixel rectangles on a <canvas> overlay sized to match the <iframe> serving
 * the PDF; we divide by the iframe width/height to get a 0–1 box. The server
 * multiplies by the actual PDF page size (from pdf-lib) to convert to PDF
 * points, flipping the Y-axis (PDF origin is bottom-left, canvas is
 * top-left). This survives zoom and resize because no absolute pixel value
 * is ever stored.
 *
 * Multi-page handling: the browser's built-in PDF viewer is opaque (no API
 * for scroll position or current page), so we expose a small page selector
 * the user toggles before drawing on a different page. Every new rectangle
 * records the current page number.
 */
import { useEffect, useRef, useState } from "react";

export interface ExistingRedaction {
  id: string;
  page: number;
  /** Normalised 0–1 box. */
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string | null;
}

export interface NewRedaction {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

interface RedactionCanvasProps {
  documentId: string;
  /** Absolute URL the iframe loads (use existing /api/files endpoint). */
  pdfUrl: string;
  existingRedactions: ExistingRedaction[];
  onSave: (redactions: NewRedaction[]) => Promise<void>;
  onCancel: () => void;
  /** Optional callback when the user removes an existing redaction. */
  onDeleteExisting?: (redactionId: string) => Promise<void>;
}

interface DraftRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

interface AiSuggestion {
  kind:
    | "name"
    | "id_number"
    | "phone"
    | "email"
    | "address"
    | "dob"
    | "account"
    | "other";
  text: string;
  confidence: number;
  rationale: string;
}

const KIND_COLOURS: Record<AiSuggestion["kind"], string> = {
  name: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  id_number:
    "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  phone:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  email:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  address:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  dob: "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
  account:
    "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  other:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export default function RedactionCanvas({
  documentId,
  pdfUrl,
  existingRedactions,
  onSave,
  onCancel,
  onDeleteExisting,
}: RedactionCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /** Drafts the user has drawn but not yet saved. */
  const [drafts, setDrafts] = useState<DraftRect[]>([]);
  /** Current page the user is annotating (defaults to 1). */
  const [currentPage, setCurrentPage] = useState(1);
  /** Active drag start point (iframe-pixel coords), null when idle. */
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  /** While dragging, the live rectangle being drawn. */
  const [liveRect, setLiveRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  /** Existing redactions removed in this session (id list). */
  const [removedExistingIds, setRemovedExistingIds] = useState<Set<string>>(
    new Set(),
  );
  /** Reason input for the most recently drawn draft. */
  const [activeReasonIdx, setActiveReasonIdx] = useState<number | null>(null);

  const [hoveredDraftIdx, setHoveredDraftIdx] = useState<number | null>(null);
  const [hoveredExistingId, setHoveredExistingId] = useState<string | null>(
    null,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI-suggested PII spans (right-hand sidebar). Hidden entirely when the
  // server reports AI is disabled (503) so we don't show a half-baked panel.
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[] | null>(
    null,
  );
  /** Indexes the user has marked as "applied" so we can grey them out. */
  const [appliedAiIdx, setAppliedAiIdx] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setAiLoading(true);
      setAiError(null);
      try {
        const res = await fetch(
          `/api/documents/${encodeURIComponent(documentId)}/ai-redact`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (res.status === 503) {
          setAiAvailable(false);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setAiError(body.error ?? `Request failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { suggestions: AiSuggestion[] };
        setAiSuggestions(body.suggestions);
      } catch (err) {
        if (cancelled) return;
        setAiError(
          err instanceof Error ? err.message : "Failed to fetch suggestions",
        );
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function highlightSuggestion(idx: number, text: string) {
    // Browser-built-in PDF iframes don't expose a search API, so the most
    // reliable cross-browser handoff is the clipboard — the user pastes
    // into the viewer's Ctrl-F. Mark the row applied either way.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard write can fail on insecure contexts; not fatal.
    }
    setAppliedAiIdx((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }

  /** Track wrapper size so overlays scale with the iframe. */
  const [size, setSize] = useState({ width: 0, height: 0 });
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

  /** Convert a client-pixel event coord to a wrapper-relative pixel coord. */
  function eventToLocal(e: React.PointerEvent<HTMLDivElement>): {
    x: number;
    y: number;
  } | null {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const r = wrapper.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
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
    // Discard tiny accidental clicks.
    if (liveRect.width < 5 || liveRect.height < 5) {
      setLiveRect(null);
      return;
    }
    // Normalise to 0–1 against the wrapper size at the moment of drawing.
    const W = size.width || 1;
    const H = size.height || 1;
    const draft: DraftRect = {
      page: currentPage,
      x: liveRect.x / W,
      y: liveRect.y / H,
      width: liveRect.width / W,
      height: liveRect.height / H,
      reason: "",
    };
    setDrafts((prev) => {
      const next = [...prev, draft];
      setActiveReasonIdx(next.length - 1);
      return next;
    });
    setLiveRect(null);
  }

  function removeDraft(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
    setActiveReasonIdx(null);
  }

  function updateDraftReason(idx: number, reason: string) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, reason } : d)),
    );
  }

  function removeExisting(id: string) {
    setRemovedExistingIds((prev) => new Set(prev).add(id));
    // Fire-and-forget if a delete handler was supplied.
    if (onDeleteExisting) {
      void onDeleteExisting(id).catch(() => {
        // On failure, restore the rect locally.
        setRemovedExistingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    }
  }

  async function handleSave() {
    if (drafts.length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        drafts.map((d) => ({
          page: d.page,
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          reason: d.reason.trim() === "" ? undefined : d.reason.trim(),
        })),
      );
      setDrafts([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save redactions",
      );
    } finally {
      setSaving(false);
    }
  }

  // Filter existing redactions by current page + not-removed.
  const visibleExisting = existingRedactions.filter(
    (r) => r.page === currentPage && !removedExistingIds.has(r.id),
  );
  const visibleDrafts = drafts
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.page === currentPage);

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
        aria-label="Redact document"
        className="relative bg-white dark:bg-gray-900 w-full h-full flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Redact document
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Click and drag to redact. Saved redactions are burned into PDF
              copies and the audit log.
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
            disabled={saving || drafts.length === 0}
            className="h-9 px-4 rounded-lg bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : drafts.length === 0
                ? "Save"
                : `Save ${drafts.length} redaction${drafts.length === 1 ? "" : "s"}`}
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Body: iframe + canvas overlay (left) + AI sidebar (right) */}
        <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 p-4 min-w-0">
          <div
            ref={wrapperRef}
            className="relative mx-auto bg-white shadow rounded overflow-hidden select-none"
            style={{
              width: "min(100%, 1100px)",
              height: "calc(100vh - 10rem)",
              touchAction: "none",
              cursor: "crosshair",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              title="PDF for redaction"
              className="w-full h-full border-0 pointer-events-none"
            />

            {/* Existing redactions for this page (semi-transparent). */}
            {visibleExisting.map((r) => (
              <div
                key={r.id}
                className="absolute bg-black/60 border border-black/80 group"
                style={{
                  left: r.x * size.width,
                  top: r.y * size.height,
                  width: r.width * size.width,
                  height: r.height * size.height,
                }}
                onMouseEnter={() => setHoveredExistingId(r.id)}
                onMouseLeave={() => setHoveredExistingId(null)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {hoveredExistingId === r.id && onDeleteExisting && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeExisting(r.id);
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center shadow"
                    aria-label="Remove redaction"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {/* New drafts for this page (solid black, opaque). */}
            {visibleDrafts.map(({ d, i }) => (
              <div
                key={i}
                className="absolute bg-black border border-black"
                style={{
                  left: d.x * size.width,
                  top: d.y * size.height,
                  width: d.width * size.width,
                  height: d.height * size.height,
                }}
                onMouseEnter={() => setHoveredDraftIdx(i)}
                onMouseLeave={() => setHoveredDraftIdx(null)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {hoveredDraftIdx === i && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraft(i);
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center shadow"
                    aria-label="Remove draft redaction"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {/* In-progress drag rectangle. */}
            {liveRect && (
              <div
                className="absolute bg-black/40 border border-black/80 pointer-events-none"
                style={{
                  left: liveRect.x,
                  top: liveRect.y,
                  width: liveRect.width,
                  height: liveRect.height,
                }}
              />
            )}
          </div>

          {/* Reason input for the most recent draft */}
          {activeReasonIdx !== null && drafts[activeReasonIdx] && (
            <div className="mx-auto mt-3 max-w-[1100px] flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                Reason (optional)
              </label>
              <input
                type="text"
                value={drafts[activeReasonIdx].reason}
                onChange={(e) =>
                  updateDraftReason(activeReasonIdx, e.target.value)
                }
                placeholder="e.g. personal data — DPA s.4"
                className="flex-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => setActiveReasonIdx(null)}
                className="h-8 px-3 rounded-lg text-xs text-gray-500 hover:text-gray-700"
              >
                Done
              </button>
            </div>
          )}

          {/* Drafts summary */}
          {drafts.length > 0 && (
            <div className="mx-auto mt-3 max-w-[1100px] text-xs text-gray-500 dark:text-gray-400">
              {drafts.length} unsaved draft{drafts.length === 1 ? "" : "s"}{" "}
              across pages{" "}
              {Array.from(new Set(drafts.map((d) => d.page)))
                .sort((a, b) => a - b)
                .join(", ")}
              .
            </div>
          )}
        </div>

        {/* AI sidebar — hidden entirely when no provider is configured. */}
        {aiAvailable && (
          <aside
            className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col"
            aria-label="AI-suggested redactions"
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Suggested redactions (AI)
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                PII spans detected in the OCR text. Click <span className="font-medium">Highlight</span>{" "}
                to copy the text — then use the viewer&apos;s find (Ctrl-F)
                and draw a box over it.
              </p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {aiLoading && (
                <div className="text-xs text-gray-500 dark:text-gray-400 py-6 text-center">
                  Scanning document…
                </div>
              )}
              {!aiLoading && aiError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                  {aiError}
                </div>
              )}
              {!aiLoading &&
                !aiError &&
                aiSuggestions &&
                aiSuggestions.length === 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 py-6 text-center">
                    No PII detected.
                  </div>
                )}
              {!aiLoading &&
                !aiError &&
                aiSuggestions &&
                aiSuggestions.map((s, idx) => {
                  const applied = appliedAiIdx.has(idx);
                  return (
                    <div
                      key={idx}
                      className={
                        "rounded-lg border border-gray-200 dark:border-gray-800 p-2.5 space-y-1.5 transition-opacity " +
                        (applied ? "opacity-50 grayscale" : "")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={
                            "text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded " +
                            KIND_COLOURS[s.kind]
                          }
                        >
                          {s.kind.replace("_", " ")}
                        </span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                          {Math.round(s.confidence * 100)}%
                        </span>
                      </div>
                      <div className="font-mono text-xs text-gray-900 dark:text-gray-100 break-all">
                        {s.text}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {s.rationale}
                      </div>
                      <button
                        type="button"
                        onClick={() => void highlightSuggestion(idx, s.text)}
                        className="w-full h-7 px-2 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        {applied ? "Copied — find in viewer" : "Highlight in viewer"}
                      </button>
                    </div>
                  );
                })}
            </div>
          </aside>
        )}
        </div>
      </div>
    </div>
  );
}
