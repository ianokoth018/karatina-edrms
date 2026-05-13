"use client";

/**
 * Outlook Add-in task pane page.
 *
 * Renders inside Outlook (desktop + web) when an email is opened. Reads the
 * current message via `Office.context.mailbox.item`, lists metadata + any
 * attachments, and posts the email body + selected attachments to
 * `/api/office/ingest` as a multipart upload — one file per attachment plus
 * the email body as an HTML "primary" file.
 *
 * Attachments: we attempt to fetch each attachment as base64 via
 * `getAttachmentContentAsync` (requires Mailbox 1.8+). When the host doesn't
 * support that API, attachments are skipped and the body is still saved —
 * the UI surfaces a TODO badge so the user knows.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Script from "next/script";

/* ----------------------------------------------------------------------------
 * Office.js Outlook minimal type surface
 * --------------------------------------------------------------------------*/
interface EmailAddress {
  emailAddress?: string;
  displayName?: string;
}
interface MessageBody {
  getAsync(
    coercionType: unknown,
    cb: (r: { status: string; value?: string; error?: { message: string } }) => void
  ): void;
}
interface MessageAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  attachmentType?: string;
}
interface AttachmentContent {
  content: string;
  format: string; // "base64" | "url" | "eml" | "icalendar"
}
interface MessageItem {
  itemId?: string;
  subject?: string;
  from?: EmailAddress;
  sender?: EmailAddress;
  to?: EmailAddress[];
  cc?: EmailAddress[];
  dateTimeCreated?: Date | string;
  attachments?: MessageAttachment[];
  body: MessageBody;
  getAttachmentContentAsync?(
    attachmentId: string,
    cb: (r: { status: string; value: AttachmentContent; error?: { message: string } }) => void
  ): void;
}
interface OfficeGlobal {
  onReady: (
    cb?: (info: { host: string; platform: string }) => void
  ) => Promise<{ host: string; platform: string }>;
  context: { mailbox: { item: MessageItem | null } };
  CoercionType: { Html: unknown; Text: unknown };
  MailboxEnums: { AttachmentContentFormat: { Base64: string; Url: string; Eml: string; ICalendar: string } };
  AsyncResultStatus: { Succeeded: string; Failed: string };
}

/** Read `window.Office` without polluting a global ambient type. */
function getOffice(): OfficeGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Office?: OfficeGlobal }).Office;
}

interface AttachmentUI extends MessageAttachment {
  selected: boolean;
}

interface SessionResp {
  user?: { name?: string | null; email?: string | null; department?: string | null };
}

/** Base64 → Blob without large intermediate strings. */
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

/** Sanitise a filename for the form-data field. */
function safeName(s: string, fallback = "file"): string {
  const cleaned = s.replace(/[^\w.\- ]+/g, "_").trim();
  return cleaned || fallback;
}

/* ----------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------*/

export default function OutlookSavePage() {
  const [officeReady, setOfficeReady] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionResp["user"] | null>(null);

  const [subject, setSubject] = useState("");
  const [fromAddr, setFromAddr] = useState("");
  const [toAddrs, setToAddrs] = useState<string[]>([]);
  const [sentDate, setSentDate] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const [attachments, setAttachments] = useState<AttachmentUI[]>([]);
  const [attachmentsSupported, setAttachmentsSupported] = useState<boolean>(true);

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [tags, setTags] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; ref: string } | null>(null);

  // EDRMS session probe.
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

  // Once Office.js is ready, hydrate from the current mailbox item.
  const handleOfficeReady = useCallback(() => {
    const office = getOffice();
    if (!office) return;
    office.onReady().then(() => {
      setOfficeReady(true);
      const item = office.context?.mailbox?.item;
      if (!item) return;

      setSubject(item.subject ?? "");
      setTitle(item.subject ?? "");
      const from = item.from ?? item.sender;
      setFromAddr(
        from
          ? from.displayName
            ? `${from.displayName} <${from.emailAddress ?? ""}>`
            : (from.emailAddress ?? "")
          : ""
      );
      setToAddrs(
        (item.to ?? []).map((r) =>
          r.displayName
            ? `${r.displayName} <${r.emailAddress ?? ""}>`
            : (r.emailAddress ?? "")
        )
      );
      if (item.dateTimeCreated) {
        const d =
          item.dateTimeCreated instanceof Date
            ? item.dateTimeCreated
            : new Date(item.dateTimeCreated);
        setSentDate(d.toISOString());
      }
      const list = (item.attachments ?? [])
        .filter((a) => !a.isInline)
        .map<AttachmentUI>((a) => ({ ...a, selected: true }));
      setAttachments(list);
      setAttachmentsSupported(typeof item.getAttachmentContentAsync === "function");

      // Read HTML body.
      item.body.getAsync(office.CoercionType.Html, (r) => {
        if (r.status === office.AsyncResultStatus.Succeeded && r.value) {
          setBodyHtml(r.value);
        }
      });
    });
  }, []);

  /** Fetch one attachment's bytes from Outlook. Resolves to null on failure. */
  const fetchAttachment = useCallback(
    (att: AttachmentUI): Promise<Blob | null> => {
      const office = getOffice();
      const item = office?.context?.mailbox?.item;
      if (!office || !item || typeof item.getAttachmentContentAsync !== "function") {
        return Promise.resolve(null);
      }
      return new Promise<Blob | null>((resolve) => {
        item.getAttachmentContentAsync!(att.id, (r) => {
          if (r.status !== office.AsyncResultStatus.Succeeded || !r.value) {
            resolve(null);
            return;
          }
          const fmt = r.value.format;
          // Only base64 is straightforward to upload as bytes.
          if (fmt === office.MailboxEnums.AttachmentContentFormat.Base64) {
            try {
              resolve(base64ToBlob(r.value.content, att.contentType));
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });
    },
    []
  );

  const toggleAttachment = (id: string) => {
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a))
    );
  };

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setSuccess(null);
      if (!title.trim()) {
        setError("Please enter a title.");
        return;
      }

      setSubmitting(true);
      try {
        const fd = new FormData();
        fd.append("host", "outlook");
        fd.append("title", title.trim());
        if (department.trim()) fd.append("department", department.trim());
        fd.append("documentType", "EMAIL");
        if (tags.trim()) fd.append("tags", tags.trim());

        // Build the body HTML with a small header so the saved file is
        // self-contained and readable in EDRMS preview.
        const headerHtml = `
<div style="font-family:sans-serif;border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:8px">
  <div><strong>Subject:</strong> ${escapeHtml(subject)}</div>
  <div><strong>From:</strong> ${escapeHtml(fromAddr)}</div>
  <div><strong>To:</strong> ${escapeHtml(toAddrs.join(", "))}</div>
  <div><strong>Date:</strong> ${escapeHtml(sentDate)}</div>
</div>`;
        const fullHtml = `<!doctype html><html><body>${headerHtml}${bodyHtml || ""}</body></html>`;
        const bodyBlob = new Blob([fullHtml], { type: "text/html" });
        const bodyName = `${safeName(subject || "email", "email")}.html`;
        fd.append("file", bodyBlob, bodyName);

        const selected = attachments.filter((a) => a.selected);
        let attachedCount = 0;
        let skipped = 0;
        if (attachmentsSupported && selected.length > 0) {
          setProgress(`Fetching ${selected.length} attachment(s)…`);
          for (const att of selected) {
            const blob = await fetchAttachment(att);
            if (blob) {
              fd.append("file", blob, safeName(att.name, "attachment"));
              attachedCount++;
            } else {
              skipped++;
            }
          }
        } else if (selected.length > 0) {
          skipped = selected.length;
        }

        setProgress("Uploading to EDRMS…");
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
        if (skipped > 0) {
          setError(
            `Saved with ${attachedCount} attachment(s); ${skipped} attachment(s) couldn't be fetched in this Outlook host.`
          );
        }
        setProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      } finally {
        setSubmitting(false);
      }
    },
    [
      title,
      department,
      tags,
      subject,
      fromAddr,
      toAddrs,
      sentDate,
      bodyHtml,
      attachments,
      attachmentsSupported,
      fetchAttachment,
    ]
  );

  const headerSummary = useMemo(
    () => ({
      subject: subject || "(no subject)",
      from: fromAddr || "—",
      to: toAddrs.join(", ") || "—",
      date: sentDate || "—",
    }),
    [subject, fromAddr, toAddrs, sentDate]
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Script
        src="https://appsforoffice.microsoft.com/lib/1.1/hosted/office.js"
        strategy="afterInteractive"
        onLoad={handleOfficeReady}
      />
      <div className="mx-auto max-w-md p-4 space-y-4">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold">Save email to EDRMS</h1>
          <p className="text-xs text-gray-600">
            Save the open email and its attachments into the Karatina University EDRMS.
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
            {sessionUser?.department ? <> · {sessionUser.department}</> : null}
          </div>
        )}

        <section className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-800 space-y-1">
          <div><span className="font-medium">Subject:</span> {headerSummary.subject}</div>
          <div><span className="font-medium">From:</span> {headerSummary.from}</div>
          <div><span className="font-medium">To:</span> {headerSummary.to}</div>
          <div><span className="font-medium">Date:</span> {headerSummary.date}</div>
        </section>

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
              placeholder="e.g. RFP response email"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Defaults to your department"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="e.g. supplier, q2, urgent"
            />
          </div>

          <fieldset className="rounded-md border border-gray-200 bg-white p-3">
            <legend className="px-1 text-xs font-medium text-gray-700">
              Attachments
              {!attachmentsSupported && (
                <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                  TODO: not supported by this Outlook host
                </span>
              )}
            </legend>
            {attachments.length === 0 ? (
              <p className="text-xs text-gray-500">No attachments on this email.</p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    <input
                      id={`att-${a.id}`}
                      type="checkbox"
                      checked={a.selected}
                      onChange={() => toggleAttachment(a.id)}
                      disabled={!attachmentsSupported}
                      className="h-3.5 w-3.5"
                    />
                    <label htmlFor={`att-${a.id}`} className="flex-1 truncate">
                      {a.name}{" "}
                      <span className="text-gray-500">
                        ({Math.ceil(a.size / 1024)} KB)
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

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

/** Minimal HTML-escape helper for the body header. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
