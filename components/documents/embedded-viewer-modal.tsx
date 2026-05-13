"use client";

import { useEffect, useRef, useState } from "react";

interface EmbeddedViewerModalProps {
  documentId: string;
  documentTitle?: string;
  open: boolean;
  onClose: () => void;
  /** Pre-minted embed token. When omitted, the modal mints one itself. */
  token?: string;
}

/**
 * Full-screen lightbox that embeds a document via the token-protected
 * `/embed/doc/[id]` route. Drop into any page (including ERP-style
 * integration shells) to preview an EDRMS document without leaving the
 * current screen. Provides Print and Download buttons.
 */
export function EmbeddedViewerModal({
  documentId,
  documentTitle,
  open,
  onClose,
  token: providedToken,
}: EmbeddedViewerModalProps) {
  const [token, setToken] = useState<string | null>(providedToken ?? null);
  const [loading, setLoading] = useState(!providedToken);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    if (providedToken) {
      setToken(providedToken);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/documents/${documentId}/embed-token`, { method: "POST" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ token: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        setToken(data.token);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, documentId, providedToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const embedSrc = token
    ? `/embed/doc/${documentId}/file?token=${encodeURIComponent(token)}#view=FitH&zoom=page-width&toolbar=1&navpanes=0`
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={documentTitle ?? "Document viewer"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h2 className="truncate text-sm font-semibold text-gray-800">
            {documentTitle ?? "Document"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => iframeRef.current?.contentWindow?.print()}
              disabled={!token}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Print
            </button>
            {embedSrc && (
              <a
                href={embedSrc}
                download
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </header>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Loading viewer…
          </div>
        )}
        {error && (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-700">
            {error}
          </div>
        )}
        {embedSrc && !loading && !error && (
          <iframe
            ref={iframeRef}
            src={embedSrc}
            className="flex-1 w-full border-0"
            title={documentTitle ?? "Document viewer"}
          />
        )}
      </div>
    </div>
  );
}
