// -----------------------------------------------------------------------------
// Capture event notification system
// Sends email alerts when hot-folder capture events occur.
// Never throws — all errors are logged and false is returned on failure.
// -----------------------------------------------------------------------------

import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type CaptureEvent =
  | "CAPTURED"          // file successfully captured
  | "ERROR"             // file failed to capture
  | "DUPLICATE"         // duplicate detected
  | "EXCEPTION_REVIEW"  // sent to exception queue
  | "BATCH_COMPLETE";   // batch of files processed

export interface CaptureNotificationPayload {
  event: CaptureEvent;
  profileName: string;
  profileId: string;
  fileName?: string;
  documentId?: string;
  errorMessage?: string;
  batchStats?: {
    total: number;
    captured: number;
    errors: number;
    duplicates: number;
  };
  recipientEmails: string[];
}

// -----------------------------------------------------------------------------
// SMTP transport (lazy singleton)
// -----------------------------------------------------------------------------

let _transport: nodemailer.Transporter | null = null;

/**
 * Return the shared SMTP transporter, creating it on first call.
 * Uses SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS from the environment.
 */
function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport;

  const host = process.env.SMTP_HOST ?? "";
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";

  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });

  return _transport;
}

// -----------------------------------------------------------------------------
// Email formatting
// -----------------------------------------------------------------------------

/** Wrap content in a minimal inline-styled HTML shell. */
function htmlShell(
  accentColor: string,
  headerText: string,
  body: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>${headerText}</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:6px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${accentColor};padding:20px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:bold;">
                ${headerText}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:12px 32px;
                        border-top:1px solid #e8e8e8;font-size:12px;color:#888;">
              Karatina University EDRMS &mdash; Automated Capture Notification
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Render a two-column detail row for the info table. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#555;font-size:13px;
               font-weight:bold;white-space:nowrap;">${label}</td>
    <td style="padding:6px 0;color:#333;font-size:13px;">${value}</td>
  </tr>`;
}

/** Wrap rows in a plain table. */
function infoTable(rows: string): string {
  return `<table cellpadding="0" cellspacing="0"
          style="width:100%;border-collapse:collapse;margin-top:8px;">
    ${rows}
  </table>`;
}

/**
 * Format a capture event into a subject line and HTML body.
 * Internal only — exported for testing convenience.
 */
function formatEmail(payload: CaptureNotificationPayload): {
  subject: string;
  html: string;
} {
  const {
    event,
    profileName,
    fileName,
    documentId,
    errorMessage,
    batchStats,
  } = payload;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  switch (event) {
    case "CAPTURED": {
      const subject = `✅ File Captured — ${fileName ?? "unknown"}`;
      const body = `
        <p style="color:#2e7d32;font-size:15px;margin:0 0 16px;">
          A file was successfully captured into the EDRMS.
        </p>
        ${infoTable(
          row("Profile", esc(profileName)) +
            row("File", esc(fileName ?? "—")) +
            (documentId ? row("Document ID", esc(documentId)) : "")
        )}`;
      return { subject, html: htmlShell("#2e7d32", "File Captured", body) };
    }

    case "ERROR": {
      const subject = `❌ Capture Error — ${fileName ?? "unknown"}`;
      const body = `
        <p style="color:#c62828;font-size:15px;margin:0 0 16px;">
          An error occurred while capturing a file.
        </p>
        ${infoTable(
          row("Profile", esc(profileName)) +
            row("File", esc(fileName ?? "—")) +
            (errorMessage
              ? row(
                  "Error",
                  `<span style="color:#c62828;">${esc(errorMessage)}</span>`
                )
              : "")
        )}`;
      return { subject, html: htmlShell("#c62828", "Capture Error", body) };
    }

    case "DUPLICATE": {
      const subject = `⚠️ Duplicate Detected — ${fileName ?? "unknown"}`;
      const body = `
        <p style="color:#f57f17;font-size:15px;margin:0 0 16px;">
          A duplicate file was detected during capture.
        </p>
        ${infoTable(
          row("Profile", esc(profileName)) + row("File", esc(fileName ?? "—"))
        )}`;
      return {
        subject,
        html: htmlShell("#f57f17", "Duplicate Detected", body),
      };
    }

    case "EXCEPTION_REVIEW": {
      const subject = `🔍 Exception Review Required — ${fileName ?? "unknown"}`;
      const body = `
        <p style="color:#1565c0;font-size:15px;margin:0 0 16px;">
          A captured file has been placed in the exception queue and requires manual review.
        </p>
        ${infoTable(
          row("Profile", esc(profileName)) +
            row("File", esc(fileName ?? "—")) +
            (errorMessage ? row("Reason", esc(errorMessage)) : "")
        )}`;
      return {
        subject,
        html: htmlShell("#1565c0", "Exception Review Required", body),
      };
    }

    case "BATCH_COMPLETE": {
      const subject = `📦 Batch Complete — ${profileName}`;
      const stats = batchStats;
      const statsRows = stats
        ? row("Total Files", String(stats.total)) +
          row(
            "Captured",
            `<span style="color:#2e7d32;">${stats.captured}</span>`
          ) +
          row(
            "Errors",
            `<span style="color:#c62828;">${stats.errors}</span>`
          ) +
          row(
            "Duplicates",
            `<span style="color:#f57f17;">${stats.duplicates}</span>`
          )
        : "";
      const body = `
        <p style="color:#37474f;font-size:15px;margin:0 0 16px;">
          A batch capture run has completed for profile
          <strong>${esc(profileName)}</strong>.
        </p>
        ${infoTable(row("Profile", esc(profileName)) + statsRows)}`;
      return { subject, html: htmlShell("#37474f", "Batch Complete", body) };
    }
  }
}

// -----------------------------------------------------------------------------
// Recipient lookup
// -----------------------------------------------------------------------------

/**
 * Resolve notification recipients for a capture profile.
 *
 * Priority:
 *  1. `notifyEmails` array stored in CaptureProfile.metadataMapping
 *  2. CAPTURE_NOTIFY_EMAIL env var (comma-separated)
 *  3. Empty array (no recipients configured)
 */
export async function getProfileNotificationEmails(
  profileId: string
): Promise<string[]> {
  try {
    const profile = await db.captureProfile.findUnique({
      where: { id: profileId },
      select: { metadataMapping: true },
    });

    if (profile) {
      const mapping = profile.metadataMapping as Record<string, unknown>;
      const notifyEmails = mapping?.notifyEmails;

      if (
        Array.isArray(notifyEmails) &&
        notifyEmails.every((e) => typeof e === "string")
      ) {
        const emails = (notifyEmails as string[]).filter((e) => e.trim() !== "");
        if (emails.length > 0) return emails;
      }
    }
  } catch (err) {
    logger.error(
      "capture-notifications: failed to fetch profile for email lookup",
      err,
      { profileId }
    );
  }

  // Fallback to environment variable
  const envEmails = process.env.CAPTURE_NOTIFY_EMAIL;
  if (envEmails) {
    return envEmails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");
  }

  return [];
}

// -----------------------------------------------------------------------------
// Main notification sender
// -----------------------------------------------------------------------------

/**
 * Send an email notification for a capture event.
 *
 * Always logs the event regardless of whether SMTP is configured.
 * Never throws — returns false on any failure.
 */
export async function sendCaptureNotification(
  payload: CaptureNotificationPayload
): Promise<boolean> {
  const { event, profileName, profileId, fileName, recipientEmails } = payload;

  // Always emit a structured log entry for the event
  logger.info("capture-notifications: capture event", {
    event,
    profileName,
    profileId,
    fileName,
    recipients: recipientEmails.length,
  } as Record<string, unknown>);

  if (recipientEmails.length === 0) {
    logger.warn(
      "capture-notifications: no recipients configured, skipping email",
      { event, profileId }
    );
    return false;
  }

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    logger.warn(
      "capture-notifications: SMTP_HOST not configured, skipping email",
      { event, profileId }
    );
    return false;
  }

  try {
    const { subject, html } = formatEmail(payload);
    const from =
      process.env.SMTP_FROM ?? "noreply@karatina.ac.ke";

    const transport = getTransport();
    await transport.sendMail({
      from,
      to: recipientEmails.join(", "),
      subject,
      html,
    });

    logger.info("capture-notifications: email sent successfully", {
      event,
      profileId,
      subject,
      recipientCount: recipientEmails.length,
    } as Record<string, unknown>);

    return true;
  } catch (err) {
    logger.error(
      "capture-notifications: failed to send email notification",
      err,
      { event, profileId, fileName }
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Capture trigger dispatch
// ---------------------------------------------------------------------------

/**
 * Fire all enabled CaptureTrigger rows that match a captured document.
 * Dispatches to EMAIL, WEBHOOK, or IN_APP channels per row configuration.
 * Failures in one trigger do not abort the others.
 */
export async function fireTriggers(
  prisma: PrismaClient,
  input: {
    profileId: string;
    documentType?: string | null;
    registrationNumber?: string | null;
    documentId: string;
    fileId?: string | null;
    fileName: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  let triggers;
  try {
    triggers = await prisma.captureTrigger.findMany({
      where: {
        enabled: true,
        OR: [{ profileId: input.profileId }, { profileId: null }],
      },
    });
  } catch (err) {
    logger.warn("fireTriggers: failed to query triggers", { err: String(err) });
    return;
  }

  for (const t of triggers) {
    if (t.documentTypeFilter && input.documentType !== t.documentTypeFilter) continue;
    if (t.studentFilter && input.registrationNumber) {
      try {
        if (!new RegExp(t.studentFilter).test(input.registrationNumber)) continue;
      } catch {
        continue;
      }
    }

    const cfg = (t.channelConfig ?? {}) as Record<string, unknown>;
    try {
      if (t.channelType === "EMAIL") {
        const to = Array.isArray(cfg.emails) ? (cfg.emails as string[]) : [];
        if (to.length) {
          const transporter = await getTransport();
          if (transporter) {
            await transporter.sendMail({
              from: process.env.SMTP_FROM || "noreply@edrms.local",
              to: to.join(","),
              subject: `EDRMS capture: ${input.fileName}`,
              html: `<p>Captured: <b>${input.fileName}</b></p><p>Document ID: ${input.documentId}</p>`,
            });
          }
        }
      } else if (t.channelType === "WEBHOOK") {
        const url = typeof cfg.url === "string" ? cfg.url : null;
        if (url) {
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "capture.completed", ...input }),
          }).catch(() => null);
        }
      } else if (t.channelType === "IN_APP") {
        const userIds = Array.isArray(cfg.userIds) ? (cfg.userIds as string[]) : [];
        for (const userId of userIds) {
          await prisma.notification.create({
            data: {
              userId,
              type: "CAPTURE",
              title: `Document captured: ${input.fileName}`,
              body: `A new document has been captured (ID: ${input.documentId})`,
              linkUrl: `/records/documents/${input.documentId}`,
            },
          });
        }
      }
    } catch (err) {
      logger.warn("fireTriggers: dispatch failed", {
        triggerId: t.id,
        channelType: t.channelType,
        err: String(err),
      });
    }
  }
}
