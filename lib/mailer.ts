import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import * as React from "react";
import { logger } from "@/lib/logger";
import { getSmtpConfig, type SmtpConfig } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Mailer — Nodemailer transport + react-email rendering for branded
// transactional emails.
//
// Configuration is loaded from the AppSetting table (managed via the
// /admin/email UI). Falls back to SMTP_* environment variables when no
// row exists yet so existing deployments keep working.
// ---------------------------------------------------------------------------

let _cached: { cfg: SmtpConfig; transport: nodemailer.Transporter; key: string } | null = null;

function cfgKey(c: SmtpConfig): string {
  // Cache key changes when any setting changes, forcing a fresh transport.
  return `${c.host}|${c.port}|${c.secure}|${c.user}|${c.password.slice(0, 4)}`;
}

async function getTransportAndConfig(): Promise<{ transport: nodemailer.Transporter; cfg: SmtpConfig } | null> {
  const cfg = await getSmtpConfig();
  if (!cfg || !cfg.host) return null;

  const key = cfgKey(cfg);
  if (_cached && _cached.key === key) {
    return { transport: _cached.transport, cfg: _cached.cfg };
  }

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
  });
  _cached = { cfg, transport, key };
  return { transport, cfg };
}

/**
 * Force a reload on next sendMail — call this from the settings PUT handler
 * if you want to invalidate the cache immediately. (We also invalidate
 * lazily via the cache-key check, so this is optional.)
 */
export function invalidateMailerCache(): void {
  _cached = null;
}

export interface MailOptions {
  to: string | string[];
  subject: string;
  /** Either a pre-built HTML string OR a React element (rendered via react-email) */
  html?: string;
  react?: React.ReactElement;
  text?: string;
}

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Render a react-email element to an HTML string. Preserves email-client
 * compatibility (inlines styles, table-based layout, etc.).
 */
export async function renderEmail(element: React.ReactElement): Promise<string> {
  return render(element);
}

/**
 * Render a react-email element to a plain-text fallback for clients that
 * don't render HTML.
 */
export async function renderEmailText(element: React.ReactElement): Promise<string> {
  return render(element, { plainText: true });
}

/**
 * Send an email. Accepts either a pre-built HTML string (legacy) or a
 * React element (preferred — see emails/ for templates). Returns true on
 * success, false on failure (caller should fall back to in-app notification).
 */
export async function sendMail(options: MailOptions): Promise<boolean> {
  const transportAndCfg = await getTransportAndConfig();
  if (!transportAndCfg) {
    logger.warn("SMTP not configured — skipping email delivery", { to: options.to });
    return false;
  }
  const { transport, cfg } = transportAndCfg;

  let html = options.html;
  let text = options.text;

  if (!html && options.react) {
    try {
      html = await renderEmail(options.react);
      if (!text) text = await renderEmailText(options.react);
    } catch (error) {
      logger.error("Failed to render email template", error, { subject: options.subject });
      return false;
    }
  }

  if (!html) {
    logger.warn("sendMail called with no html or react element", { subject: options.subject });
    return false;
  }

  try {
    await transport.sendMail({
      from: cfg.fromAddress,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, ""),
    });
    return true;
  } catch (error) {
    logger.error("Email delivery failed", error, { to: options.to, subject: options.subject });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Legacy helper — kept for backward compatibility with code paths that still
// build raw HTML. New code should pass `react: <Template ... />` to sendMail
// using a template from the emails/ directory.
// ---------------------------------------------------------------------------
export function buildWorkflowEmail(params: {
  recipientName: string;
  subject: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}): string {
  const { recipientName, subject, body, actionUrl, actionLabel } = params;
  const btnHtml = actionUrl
    ? `<p style="margin:24px 0"><a href="${actionUrl}" style="background:#02773b;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">${actionLabel ?? "View Task"}</a></p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="color:#02773b;margin-bottom:8px">${subject}</h2>
  <p>Dear ${recipientName},</p>
  <p style="line-height:1.6">${body}</p>
  ${btnHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
  <p style="font-size:12px;color:#6b7280">This is an automated message from the Karatina University EDRMS. Please do not reply to this email.</p>
</body>
</html>`.trim();
}
