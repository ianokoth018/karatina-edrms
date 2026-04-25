"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import SignatureCanvasUntyped from "react-signature-canvas";

// react-signature-canvas v1.1.0-alpha's bundled types only declare a tiny
// subset of the props that the underlying signature_pad library accepts.
// Cast to a permissive type so we can pass penColor / minWidth / maxWidth /
// velocityFilterWeight / throttle / backgroundColor through to the engine.
type SignatureCanvasInstance = {
  clear: () => void;
  isEmpty: () => boolean;
  toData: () => unknown[];
  fromData: (d: unknown[]) => void;
  getCanvas: () => HTMLCanvasElement;
  getTrimmedCanvas: () => HTMLCanvasElement;
};
const SignatureCanvas = SignatureCanvasUntyped as unknown as React.ComponentType<{
  ref?: React.Ref<SignatureCanvasInstance>;
  penColor?: string;
  minWidth?: number;
  maxWidth?: number;
  velocityFilterWeight?: number;
  throttle?: number;
  backgroundColor?: string;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
}>;

/**
 * Profile-page card for managing the user's saved signature + office stamp.
 *
 * Uses the `react-signature-canvas` wrapper around the `signature_pad`
 * library (the same engine used by DocuSign / HelloSign) for:
 *   - Bezier-smoothed strokes — natural curves on mouse, pen, touch
 *   - Velocity-based stroke width (thicker on slow strokes)
 *   - Proper pointer + touch event handling, including Apple Pencil
 *   - Built-in trim-to-content for tight signature crops
 */
export interface SignaturePanelProps {
  userId: string;
}

export default function SignaturePanel({ userId }: SignaturePanelProps) {
  const sigRef = useRef<SignatureCanvasInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stampFileRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  /** Probed via HEAD on mount + after every save/remove. */
  const [hasSignature, setHasSignature] = useState<boolean | null>(null);
  const [hasStamp, setHasStamp] = useState<boolean | null>(null);
  /** Show the editor only when needed: when there's no asset yet, or
   *  when the user explicitly clicks "Replace …". */
  const [editingSignature, setEditingSignature] = useState(false);
  const [editingStamp, setEditingStamp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [penColor, setPenColor] = useState<string>("#0f172a");
  const [penWeight, setPenWeight] = useState<"fine" | "medium" | "bold">("medium");

  // Keep the canvas internal pixel dimensions in sync with the CSS box for
  // sharp lines on hi-DPI displays. signature_pad doesn't auto-handle resize.
  useEffect(() => {
    function resizeCanvas() {
      const wrapper = wrapperRef.current;
      const sig = sigRef.current;
      if (!wrapper || !sig) return;
      const canvas = sig.getCanvas();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      // Save the current ink so resize doesn't blank the canvas mid-stroke.
      const wasEmpty = sig.isEmpty();
      const data = wasEmpty ? null : sig.toData();
      canvas.width = wrapper.clientWidth * ratio;
      canvas.height = wrapper.clientHeight * ratio;
      const ctx = canvas.getContext("2d");
      ctx?.scale(ratio, ratio);
      sig.clear();
      if (data) sig.fromData(data);
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  const refreshPreviews = useCallback(async () => {
    const v = Date.now();
    const sigUrl = `/api/profile/signature/${userId}?kind=signature&v=${v}`;
    const stampUrlNew = `/api/profile/signature/${userId}?kind=stamp&v=${v}`;
    setSignatureUrl(sigUrl);
    setStampUrl(stampUrlNew);

    // Probe both assets so we know whether to render the editor.
    try {
      const [sigRes, stampRes] = await Promise.all([
        fetch(sigUrl, { method: "HEAD" }),
        fetch(stampUrlNew, { method: "HEAD" }),
      ]);
      setHasSignature(sigRes.ok);
      setHasStamp(stampRes.ok);
      // Auto-open the editor on first load when nothing is saved yet.
      if (!sigRes.ok) setEditingSignature(true);
    } catch {
      setHasSignature(false);
      setHasStamp(false);
      setEditingSignature(true);
    }
  }, [userId]);

  useEffect(() => {
    void refreshPreviews();
  }, [refreshPreviews]);

  function clearPad() {
    sigRef.current?.clear();
  }

  function undoLastStroke() {
    const sig = sigRef.current;
    if (!sig) return;
    const data = sig.toData();
    if (!data || data.length === 0) return;
    data.pop();
    sig.fromData(data);
  }

  async function saveDrawnSignature() {
    const sig = sigRef.current;
    if (!sig) return;
    if (sig.isEmpty()) {
      setError("Please draw your signature first.");
      return;
    }
    // getTrimmedCanvas crops to just the inked pixels — produces a tight,
    // PDF-friendly signature image instead of a giant transparent rectangle.
    const dataUrl = sig.getTrimmedCanvas().toDataURL("image/png");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/profile/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, kind: "signature" }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setError(e?.error ?? "Save failed");
      } else {
        setInfo("Signature saved.");
        sig.clear();
        setEditingSignature(false);
        await refreshPreviews();
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  async function uploadFile(
    e: React.ChangeEvent<HTMLInputElement>,
    kind: "signature" | "stamp",
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) {
      setError("Maximum file size is 1 MiB.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch("/api/profile/signature", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Upload failed");
      } else {
        setInfo(kind === "stamp" ? "Office stamp saved." : "Signature saved.");
        if (kind === "stamp") setEditingStamp(false);
        else setEditingSignature(false);
        await refreshPreviews();
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  async function remove(kind: "signature" | "stamp") {
    if (!confirm(`Remove your ${kind === "stamp" ? "office stamp" : "signature"}?`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/profile/signature?kind=${kind}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Remove failed");
      } else {
        setInfo(kind === "stamp" ? "Office stamp removed." : "Signature removed.");
        // Removing the asset re-opens the editor for that kind so the user
        // can immediately replace it.
        if (kind === "stamp") setEditingStamp(true);
        else setEditingSignature(true);
        await refreshPreviews();
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  // Velocity-based min/max stroke widths. The defaults give that natural
  // calligraphy feel where slow strokes are thicker than fast ones.
  const penWeights: Record<typeof penWeight, { min: number; max: number }> = {
    fine: { min: 0.4, max: 1.5 },
    medium: { min: 0.6, max: 2.6 },
    bold: { min: 1.2, max: 4.0 },
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Signature &amp; Office Stamp
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Saved here once, embedded on every memo you initiate. Draw with your
          finger / mouse / stylus, or upload a transparent PNG.
        </p>
      </div>

      <div className="p-5 space-y-5">
        {/* ---- Current signature preview ---- */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Personal signature
            </span>
            {hasSignature && !editingSignature && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSignature(true)}
                  disabled={busy}
                  className="text-[11px] font-medium text-[#02773b] dark:text-[#60c988] hover:underline disabled:opacity-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => remove("signature")}
                  disabled={busy}
                  className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 flex items-center justify-center min-h-[80px]">
            {signatureUrl && (
              <SignaturePreview src={signatureUrl} alt="Personal signature" emptyLabel="No signature saved yet" />
            )}
          </div>
        </div>

        {/* ---- Draw / Upload editor (hidden once a signature is saved) ---- */}
        {editingSignature && (
        <div>
          <div className="flex gap-1 mb-3 border-b border-gray-200 dark:border-gray-800">
            {(["draw", "upload"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors capitalize ${
                  mode === m
                    ? "border-[#02773b] text-[#02773b]"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {m === "draw" ? "Draw" : "Upload PNG"}
              </button>
            ))}
          </div>

          {mode === "draw" ? (
            <div className="space-y-3">
              {/* Pen toolbar — colour + weight */}
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-0.5">
                    Ink
                  </span>
                  {[
                    { hex: "#0f172a", name: "Black" },
                    { hex: "#1d4ed8", name: "Blue" },
                    { hex: "#02773b", name: "Karu green" },
                  ].map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setPenColor(c.hex)}
                      title={c.name}
                      className={`w-5 h-5 rounded-full border-2 transition-transform ${
                        penColor === c.hex
                          ? "border-gray-700 dark:border-gray-200 scale-110"
                          : "border-gray-300 dark:border-gray-600"
                      }`}
                      style={{ background: c.hex }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mr-0.5">
                    Weight
                  </span>
                  {(["fine", "medium", "bold"] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setPenWeight(w)}
                      className={`px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        penWeight === w
                          ? "bg-[#02773b] text-white"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={undoLastStroke}
                    disabled={busy}
                    title="Undo last stroke"
                    className="px-2 py-1 rounded-md text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={clearPad}
                    disabled={busy}
                    className="px-2 py-1 rounded-md text-[11px] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* The pad itself — bg-white so the saved PNG has a clean
                  transparent-feeling background; the wrapper carries the
                  dashed border indicating the signing area. */}
              <div
                ref={wrapperRef}
                className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 overflow-hidden h-44 sm:h-56 relative"
              >
                <SignatureCanvas
                  ref={sigRef}
                  penColor={penColor}
                  minWidth={penWeights[penWeight].min}
                  maxWidth={penWeights[penWeight].max}
                  velocityFilterWeight={0.7}
                  throttle={16}
                  backgroundColor="rgba(0,0,0,0)"
                  canvasProps={{
                    className: "w-full h-full touch-none cursor-crosshair",
                  }}
                />
                {/* Faint baseline guide so the user knows where to sign. */}
                <div
                  className="pointer-events-none absolute left-6 right-6 border-b border-gray-200 dark:border-gray-700"
                  style={{ bottom: "30%" }}
                />
                <div className="pointer-events-none absolute left-3 bottom-2 text-[10px] uppercase tracking-widest text-gray-300 dark:text-gray-600 select-none">
                  Sign here
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveDrawnSignature}
                  disabled={busy}
                  className="px-4 h-9 rounded-lg bg-[#02773b] text-white text-xs font-semibold hover:bg-[#014d28] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save signature"}
                </button>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">
                  Tip: a transparent PNG scanned from a paper signature gives
                  the cleanest output.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors py-6 px-4 flex flex-col items-center text-center disabled:opacity-50"
              >
                <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Click to upload a signature image
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  PNG / JPEG / WebP, max 1 MiB. Transparent PNG works best.
                </p>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => uploadFile(e, "signature")}
                className="sr-only"
              />
            </div>
          )}
          {/* Cancel out of replace-mode without changing anything */}
          {hasSignature && (
            <button
              type="button"
              onClick={() => setEditingSignature(false)}
              disabled={busy}
              className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
            >
              Cancel — keep my current signature
            </button>
          )}
        </div>
        )}

        {/* ---- Office stamp ---- */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Office stamp / seal
              </span>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Optional. Officers (Registrar, HOD, etc.) can upload a circular
                stamp that overlays the signature on official memos.
              </p>
            </div>
            {hasStamp && !editingStamp && (
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <button
                  type="button"
                  onClick={() => setEditingStamp(true)}
                  disabled={busy}
                  className="text-[11px] font-medium text-[#02773b] dark:text-[#60c988] hover:underline disabled:opacity-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => remove("stamp")}
                  disabled={busy}
                  className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 flex items-center justify-center min-h-[80px] mb-3">
            {stampUrl && (
              <SignaturePreview src={stampUrl} alt="Office stamp" emptyLabel="No stamp uploaded" />
            )}
          </div>
          {/* Show the upload control only when there's no stamp yet, or
           *  when the user explicitly clicked Replace. */}
          {(!hasStamp || editingStamp) && (
            <>
              <button
                type="button"
                onClick={() => stampFileRef.current?.click()}
                disabled={busy}
                className="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors py-3 text-xs text-gray-600 dark:text-gray-300 disabled:opacity-50"
              >
                Upload stamp / seal (PNG with transparent background)
              </button>
              {hasStamp && editingStamp && (
                <button
                  type="button"
                  onClick={() => setEditingStamp(false)}
                  disabled={busy}
                  className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
                >
                  Cancel — keep my current stamp
                </button>
              )}
            </>
          )}
          <input
            ref={stampFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => uploadFile(e, "stamp")}
            className="sr-only"
          />
        </div>

        {info && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {info}
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function SignaturePreview({
  src,
  alt,
  emptyLabel,
}: {
  src: string;
  alt: string;
  emptyLabel: string;
}) {
  // Reset to "assume image exists" each time `src` changes — without this
  // the component sticks on the empty state set by the first 404, and
  // never re-renders the image after the user uploads/draws a signature.
  const [hasImage, setHasImage] = useState(true);
  useEffect(() => {
    setHasImage(true);
  }, [src]);

  return hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setHasImage(false)}
      className="max-h-20 max-w-full object-contain"
    />
  ) : (
    <span className="text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</span>
  );
}
