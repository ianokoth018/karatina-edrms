"use client";
import React, { useRef, useState, useCallback } from "react";

interface TusUploaderProps {
  documentId: string;
  onComplete?: (storagePath: string) => void;
  onError?: (error: string) => void;
  accept?: string;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

export function TusUploader({ documentId, onComplete, onError, accept }: TusUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const upload = useCallback(async (file: File) => {
    abortRef.current = false;
    setStatus("uploading");
    setProgress(0);
    setError(null);

    try {
      // Encode metadata
      const encodeMetadata = (key: string, value: string) =>
        `${key} ${btoa(unescape(encodeURIComponent(value)))}`;
      const metadataHeader = [
        encodeMetadata("filename", file.name),
        encodeMetadata("mimeType", file.type || "application/octet-stream"),
        encodeMetadata("documentId", documentId),
      ].join(",");

      // Create upload
      const createRes = await fetch("/api/upload/tus", {
        method: "POST",
        headers: {
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(file.size),
          "Upload-Metadata": metadataHeader,
        },
      });

      if (!createRes.ok) throw new Error(`Failed to create upload: ${createRes.status}`);
      const location = createRes.headers.get("Location");
      if (!location) throw new Error("No Location header in TUS response");

      // Upload chunks
      let offset = 0;
      while (offset < file.size) {
        if (abortRef.current) throw new Error("Upload cancelled");

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        const patchRes = await fetch(location, {
          method: "PATCH",
          headers: {
            "Tus-Resumable": "1.0.0",
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": String(offset),
          },
          body: buffer,
        });

        if (!patchRes.ok) throw new Error(`Chunk upload failed: ${patchRes.status}`);

        const newOffset = parseInt(patchRes.headers.get("Upload-Offset") ?? "0", 10);
        offset = newOffset;
        setProgress(Math.round((offset / file.size) * 100));
      }

      setStatus("done");
      setProgress(100);
      onComplete?.(location);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
      setStatus("error");
      onError?.(msg);
    }
  }, [documentId, onComplete, onError]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
        disabled={status === "uploading"}
      />

      {status === "idle" || status === "error" ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-6 text-sm text-gray-500 dark:text-gray-400 hover:border-[#02773b] hover:text-[#02773b] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          {status === "error" ? "Retry upload" : "Click to upload (resumable)"}
        </button>
      ) : null}

      {status === "uploading" && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-[#02773b] h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => { abortRef.current = true; setStatus("idle"); }}
            className="text-xs text-red-500 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {status === "done" && (
        <div className="flex items-center gap-2 text-sm text-[#02773b]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Upload complete
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
