"use client";

/**
 * Office Add-in task pane page for Word / Excel / PowerPoint.
 *
 * Loaded inside the Office host (Word, Excel, PowerPoint) as a task pane.
 * The page asks the host for the current document's bytes via Office.js's
 * `getFileAsync` API, then POSTs them to `/api/office/ingest` to be saved
 * as an EDRMS Document.
 *
 * Auth: relies on the same browser session as the EDRMS app. If the user
 * isn't signed in, we show a "Please sign in" prompt with a link.
 *
 * Office.js is loaded from the Microsoft CDN — we do NOT bundle it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Script from "next/script";

/* ----------------------------------------------------------------------------
 * Office.js minimal type surface
 * --------------------------------------------------------------------------*/
type OfficeHost = "word" | "excel" | "powerpoint";

interface OfficeFileSlice {
  data: ArrayBuffer | Uint8Array | number[];
}
interface OfficeFile {
  size: number;
  sliceCount: number;
  getSliceAsync(
    index: number,
    cb: (r: { status: string; value: OfficeFileSlice; error?: { message: string } }) => void
  ): void;
  closeAsync(cb?: (r: { status: string }) => void): void;
}
interface OfficeAsyncResult<T> {
  status: string;
  value: T;
  error?: { message: string };
}
interface OfficeDocument {
  getFileAsync(
    fileType: unknown,
    options: { sliceSize: number },
    cb: (r: OfficeAsyncResult<OfficeFile>) => void
  ): void;
}
interface OfficeContext {
  document: OfficeDocument;
}
interface OfficeGlobal {
  onReady: (cb?: (info: { host: string; platform: string }) => void) => Promise<{ host: string; platform: string }>;
  context: OfficeContext;
  FileType: { Compressed: unknown; Text: unknown };
  AsyncResultStatus: { Succeeded: string; Failed: string };
}

/** Read `window.Office` without polluting a global ambient type. */
function getOffice(): OfficeGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Office?: OfficeGlobal }).Office;
}

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

/** Extension + MIME for each host. Used when assembling the upload Blob. */
const HOST_META: Record<OfficeHost, { ext: string; mime: string; label: string }> = {
  word: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word document",
  },
  excel: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel workbook",
  },
  powerpoint: {
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint presentation",
  },
};

/** Document type options. Mirrors the existing EDRMS upload page choices. */
const DOC_TYPES = [
  { value: "MEMO", label: "Memo" },
  { value: "LETTER", label: "Letter" },
  { value: "REPORT", label: "Report" },
  { value: "FORM", label: "Form" },
  { value: "POLICY", label: "Policy" },
  { value: "MINUTES", label: "Meeting Minutes" },
  { value: "PROPOSAL", label: "Proposal" },
  { value: "OTHER", label: "Other" },
];

/** Read `?host=...` from window.location without pulling in next/navigation. */
function readHostParam(): OfficeHost {
  if (typeof window === "undefined") return "word";
  const url = new URL(window.location.href);
  const raw = (url.searchParams.get("host") ?? "word").toLowerCase();
  if (raw === "word" || raw === "excel" || raw === "powerpoint") return raw;
  return "word";
}

/**
 * Slice-by-slice read of the entire current Office document.
 * Each slice is up to ~4 MB; we concatenate them in order into a single
 * Blob suitable for upload.
 */
async function readOfficeDocument(office: OfficeGlobal, mime: string): Promise<Blob> {
  const file = await new Promise<OfficeFile>((resolve, reject) => {
    office.context.document.getFileAsync(
      office.FileType.Compressed,
      { sliceSize: 4 * 1024 * 1024 },
      (r) => {
        if (r.status === office.AsyncResultStatus.Succeeded) resolve(r.value);
        else reject(new Error(r.error?.message ?? "Failed to read document"));
      }
    );
  });

  try {
    const parts: Uint8Array[] = new Array(file.sliceCount);
    for (let i = 0; i < file.sliceCount; i++) {
      const slice = await new Promise<OfficeFileSlice>((resolve, reject) => {
        file.getSliceAsync(i, (r) => {
          if (r.status === office.AsyncResultStatus.Succeeded) resolve(r.value);
          else reject(new Error(r.error?.message ?? `Failed to read slice ${i}`));
        });
      });
      const data = slice.data;
      if (data instanceof Uint8Array) parts[i] = data;
      else if (data instanceof ArrayBuffer) parts[i] = new Uint8Array(data);
      else parts[i] = new Uint8Array(data as number[]);
    }
    return new Blob(parts as BlobPart[], { type: mime });
  } finally {
    await new Promise<void>((resolve) => file.closeAsync(() => resolve()));
  }
}

/* ----------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------*/

interface SessionResp {
  user?: { name?: string | null; email?: string | null; department?: string | null };
}

export default function OfficeSavePage() {
  const host = useMemo<OfficeHost>(() => readHostParam(), []);
  const meta = HOST_META[host];

  const [officeReady, setOfficeReady] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionResp["user"] | null>(null);

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [documentType, setDocumentType] = useState("REPORT");
  const [tags, setTags] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; ref: string } | null>(null);

  // Probe the EDRMS session (same cookie as the main app).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionResp | null) => {
        if (cancelled) return;
        if (data && data.user && (data.user.email || data.user.name)) {
          setSignedIn(true);
          setSessionUser(data.user);
          if (data.user.department) setDepartment(data.user.department);
        } else {
          setSignedIn(false);
        }
      })
      .catch(() => !cancelled && setSignedIn(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Wait for Office.js to finish initialising.
  const handleOfficeScriptReady = useCallback(() => {
    const office = getOffice();
    if (!office) return;
    office.onReady().then(() => setOfficeReady(true)).catch(() => setOfficeReady(false));
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(null);
      if (!title.trim()) {
        setError("Please enter a title.");
        return;
      }
      const office = getOffice();
      if (!office) {
        setError("Office.js is not loaded yet — please wait a moment and try again.");
        return;
      }

      setSubmitting(true);
      try {
        setProgress("Reading document from Office…");
        const blob = await readOfficeDocument(office, meta.mime);

        setProgress("Uploading to EDRMS…");
        const filename = `${title.trim().replace(/[^\w.-]+/g, "_") || "document"}.${meta.ext}`;
        const fd = new FormData();
        fd.append("host", host);
        fd.append("title", title.trim());
        if (department.trim()) fd.append("department", department.trim());
        fd.append("documentType", documentType);
        if (tags.trim()) fd.append("tags", tags.trim());
        fd.append("file", blob, filename);

        const resp = await fetch("/api/office/ingest", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const json = (await resp.json().catch(() => null)) as
          | { documentId: string; referenceNumber: string; error?: string }
          | null;
        if (!resp.ok || !json || json.error) {
          throw new Error(json?.error ?? `Upload failed (${resp.status})`);
        }
        setSuccess({ id: json.documentId, ref: json.referenceNumber });
        setProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      } finally {
        setSubmitting(false);
      }
    },
    [title, department, documentType, tags, host, meta.mime, meta.ext]
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Script
        src="https://appsforoffice.microsoft.com/lib/1.1/hosted/office.js"
        strategy="afterInteractive"
        onLoad={handleOfficeScriptReady}
      />
      <div className="mx-auto max-w-md p-4 space-y-4">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold">Save to EDRMS</h1>
          <p className="text-xs text-gray-600">
            Save this {meta.label} into the Karatina University EDRMS.
          </p>
        </header>

        {signedIn === false && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            You aren&apos;t signed in to EDRMS. Open the EDRMS in a normal
            browser tab, sign in, then come back to this pane.
            <div className="mt-2">
              <a
                href="/login"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                Open sign-in page
              </a>
            </div>
          </div>
        )}

        {signedIn && (
          <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
            Signed in as{" "}
            <span className="font-medium">
              {sessionUser?.name ?? sessionUser?.email ?? "user"}
            </span>
            {sessionUser?.department ? (
              <> · {sessionUser.department}</>
            ) : null}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="e.g. Q2 Finance Report"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Department
            </label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Defaults to your department"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Document type
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {DOC_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="e.g. budget, q2, draft"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !signedIn || !officeReady}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            {submitting
              ? progress ?? "Saving…"
              : !officeReady
                ? "Loading Office.js…"
                : !signedIn
                  ? "Sign in to EDRMS first"
                  : "Save to EDRMS"}
          </button>
        </form>

        {progress && submitting && (
          <p className="text-xs text-gray-600">{progress}</p>
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            Saved as <span className="font-medium">{success.ref}</span>.{" "}
            <a
              href={`/documents/${success.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Open in EDRMS
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
