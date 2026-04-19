"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ---------- types ---------- */

interface Signer {
  id: string;
  name: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
}

interface Signature {
  id: string;
  signatureType: string;
  signatureData: string;
  reason: string | null;
  designation: string | null;
  isVerified: boolean;
  signedAt: string;
  signer: Signer;
}

type SignTab = "draw" | "type" | "upload";

const REASON_OPTIONS = [
  "Approved",
  "Reviewed",
  "Witnessed",
  "Acknowledged",
  "Custom...",
];

/* ---------- helpers ---------- */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400">
      {initials}
    </div>
  );
}

/* ---------- drawing canvas ---------- */

function DrawingCanvas({
  onDone,
}: {
  onDone: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  function getPos(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function startDraw(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    e.preventDefault();
    isDrawingRef.current = true;
    lastPointRef.current = getPos(e);
  }

  function draw(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    e.preventDefault();
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const point = getPos(e);
    const last = lastPointRef.current;
    if (last) {
      ctx.strokeStyle = "#02773b";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
  }

  function endDraw() {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function handleDone() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onDone(dataUrl);
  }

  return (
    <div className="space-y-3">
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
        <canvas
          ref={canvasRef}
          width={460}
          height={160}
          className="w-full cursor-crosshair touch-none"
          style={{ height: "160px" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Draw your signature above using mouse or touch
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clearCanvas}
          className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="h-8 px-4 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#025f30] transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export default function SignaturePanel({
  documentId,
  currentUserId,
}: {
  documentId: string;
  currentUserId: string;
}) {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* signing state */
  const [showSigning, setShowSigning] = useState(false);
  const [signTab, setSignTab] = useState<SignTab>("draw");
  const [signatureData, setSignatureData] = useState("");
  const [typedText, setTypedText] = useState("");
  const [uploadPreview, setUploadPreview] = useState("");
  const [reasonOption, setReasonOption] = useState("Approved");
  const [customReason, setCustomReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* fetch signatures */
  const fetchSignatures = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/signatures`);
      if (!res.ok) throw new Error("Failed to load signatures");
      const data = await res.json();
      setSignatures(data.signatures ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load signatures");
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchSignatures();
  }, [fetchSignatures]);

  /* file upload handler */
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!["image/png", "image/jpeg", "image/jpg"].includes(file.type)) {
      setError("Only PNG and JPG files are accepted");
      return;
    }

    // Validate size (500KB)
    if (file.size > 500 * 1024) {
      setError("File must be under 500KB");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setUploadPreview(base64);
      setSignatureData(base64);
    };
    reader.readAsDataURL(file);
  }

  /* submit signature */
  async function handleSubmit() {
    let finalData = "";
    let signatureType = "";

    if (signTab === "draw") {
      if (!signatureData) {
        setError("Please draw your signature first");
        return;
      }
      finalData = signatureData;
      signatureType = "DRAWN";
    } else if (signTab === "type") {
      if (!typedText.trim()) {
        setError("Please type your signature");
        return;
      }
      finalData = typedText.trim();
      signatureType = "TYPED";
    } else if (signTab === "upload") {
      if (!signatureData) {
        setError("Please upload a signature image");
        return;
      }
      finalData = signatureData;
      signatureType = "UPLOADED";
    }

    const reason =
      reasonOption === "Custom..." ? customReason.trim() : reasonOption;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/signatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureType,
          signatureData: finalData,
          reason: reason || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to sign document");
      }

      // Reset and refresh
      setShowSigning(false);
      setSignatureData("");
      setTypedText("");
      setUploadPreview("");
      setReasonOption("Approved");
      setCustomReason("");
      setSignTab("draw");
      await fetchSignatures();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign document");
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ---------- render ---------- */

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        </div>
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Signatures
          {signatures.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400 text-xs font-semibold">
              {signatures.length}
            </span>
          )}
        </h3>
        {!showSigning && (
          <button
            onClick={() => setShowSigning(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#025f30] transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
              />
            </svg>
            Sign Document
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Signing UI */}
      {showSigning && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Add Your Signature
            </h4>
            <button
              onClick={() => {
                setShowSigning(false);
                setError(null);
                setSignatureData("");
                setTypedText("");
                setUploadPreview("");
              }}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-200 dark:bg-gray-700 rounded-lg p-0.5">
            {(["draw", "type", "upload"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setSignTab(tab);
                  setSignatureData("");
                  setTypedText("");
                  setUploadPreview("");
                  setError(null);
                }}
                className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${
                  signTab === tab
                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Draw tab */}
          {signTab === "draw" && (
            <DrawingCanvas
              onDone={(dataUrl) => setSignatureData(dataUrl)}
            />
          )}

          {/* Type tab */}
          {signTab === "type" && (
            <div className="space-y-3">
              <input
                type="text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                placeholder="Type your full name"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                style={{
                  fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                  fontSize: "18px",
                }}
              />
              {typedText && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-4 flex items-center justify-center min-h-[80px]">
                  <span
                    className="text-[#02773b] dark:text-emerald-400"
                    style={{
                      fontFamily:
                        "'Brush Script MT', 'Segoe Script', cursive",
                      fontSize: "28px",
                    }}
                  >
                    {typedText}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Upload tab */}
          {signTab === "upload" && (
            <div className="space-y-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-6 text-center cursor-pointer hover:border-[#02773b] hover:bg-[#02773b]/5 dark:hover:border-emerald-600 transition-colors"
              >
                {uploadPreview ? (
                  <img
                    src={uploadPreview}
                    alt="Signature preview"
                    className="mx-auto max-h-24 object-contain"
                  />
                ) : (
                  <>
                    <svg
                      className="mx-auto w-8 h-8 text-gray-300 dark:text-gray-600 mb-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Click to upload signature image
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                      PNG or JPG, max 500KB
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Reason
            </label>
            <select
              value={reasonOption}
              onChange={(e) => setReasonOption(e.target.value)}
              className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {reasonOption === "Custom..." && (
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter custom reason..."
                className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
              />
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setShowSigning(false);
                setError(null);
              }}
              className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="h-9 px-5 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#025f30] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Signing..." : "Sign Document"}
            </button>
          </div>
        </div>
      )}

      {/* Signature list */}
      {signatures.length === 0 && !showSigning && (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 px-6 py-10 text-center">
          <svg
            className="mx-auto w-10 h-10 text-gray-300 dark:text-gray-600 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            No signatures yet
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Be the first to sign this document
          </p>
        </div>
      )}

      {signatures.length > 0 && (
        <div className="space-y-3">
          {signatures.map((sig) => (
            <div
              key={sig.id}
              className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-start gap-3">
                <Initials name={sig.signer.displayName || sig.signer.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {sig.signer.displayName || sig.signer.name}
                    </span>
                    {sig.isVerified && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-emerald-400 text-[10px] font-semibold">
                        <svg
                          className="w-3 h-3"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Verified
                      </span>
                    )}
                    {sig.reason && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-medium text-gray-600 dark:text-gray-400">
                        {sig.reason}
                      </span>
                    )}
                  </div>
                  {sig.designation && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {sig.designation}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {timeAgo(sig.signedAt)}
                  </p>

                  {/* Signature preview */}
                  <div className="mt-2">
                    {sig.signatureType === "DRAWN" && (
                      <div className="inline-block border border-gray-100 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-1.5">
                        <img
                          src={sig.signatureData}
                          alt={`Signature by ${sig.signer.displayName}`}
                          className="h-10 object-contain"
                        />
                      </div>
                    )}
                    {sig.signatureType === "TYPED" && (
                      <div className="inline-block">
                        <span
                          className="text-[#02773b] dark:text-emerald-400"
                          style={{
                            fontFamily:
                              "'Brush Script MT', 'Segoe Script', cursive",
                            fontSize: "22px",
                          }}
                        >
                          {sig.signatureData}
                        </span>
                      </div>
                    )}
                    {sig.signatureType === "UPLOADED" && (
                      <div className="inline-block border border-gray-100 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-1.5">
                        <img
                          src={sig.signatureData}
                          alt={`Signature by ${sig.signer.displayName}`}
                          className="h-10 object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
