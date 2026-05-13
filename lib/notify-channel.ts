// ---------------------------------------------------------------------------
// notify-channel — single fan-out point for "tell user X about Y".
//
// Every workflow / SLA notification should funnel through `notifyUser`:
//   - always writes the in-app `Notification` row (so the bell badge works)
//   - then dispatches to whichever transports the user has opted into
//     (EMAIL / SMS / WHATSAPP / ALL — defaults to EMAIL for new users).
//
// Channel selection rules:
//   - "EMAIL"    → email only            (still falls back silently if no email)
//   - "SMS"      → SMS only              (only if user.phone present)
//   - "WHATSAPP" → WhatsApp only         (only if user.phone present + feature on)
//   - "ALL"      → email + SMS + WhatsApp (gated on the same presence checks)
//
// No transport ever throws — each is independently best-effort. The caller
// gets a `Promise<void>` and shouldn't try to detect partial failure.
// ---------------------------------------------------------------------------

import * as React from "react";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { sendSms } from "@/lib/sms";
import { sendWhatsAppText, whatsappEnabled } from "@/lib/whatsapp";
import WorkflowNotification from "@/emails/workflow-notification";

export type NotifyChannel = "EMAIL" | "SMS" | "WHATSAPP" | "ALL";

export interface NotifyUserOptions {
  userId: string;
  title: string;
  body: string;
  /** Optional CTA — used as the in-app linkUrl and the email button target. */
  ctaUrl?: string;
  /**
   * Notification.type column — defaults to "WORKFLOW_TASK" since this
   * helper is overwhelmingly used by workflow / SLA paths.
   */
  type?: string;
  /**
   * Pre-approved WhatsApp template name. Cloud API requires templates for
   * any message outside an active 24h session window, which is the case
   * for almost all of our outbound alerts. If omitted *and* the user has
   * WhatsApp enabled, we still try a text send — Meta will reject it
   * outside the window and we log+continue.
   */
  whatsappTemplate?: string;
  whatsappTemplateLang?: string;
  whatsappTemplateVariables?: string[];
}

function resolveChannel(raw: string | null | undefined): NotifyChannel {
  switch (raw) {
    case "SMS":
    case "WHATSAPP":
    case "ALL":
    case "EMAIL":
      return raw;
    default:
      return "EMAIL";
  }
}

/**
 * Compose a short transport-friendly summary from `title` + `body`. SMS
 * and WhatsApp text bodies don't carry HTML; this also trims to a sane
 * length so we don't spam multi-part SMS.
 */
function compactBody(title: string, body: string): string {
  const stripped = body.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const combined = `${title} — ${stripped}`;
  return combined.length > 480 ? `${combined.slice(0, 477)}…` : combined;
}

/**
 * The one true notify call. Always writes Notification; then dispatches
 * via the user's channel preference.
 */
export async function notifyUser(opts: NotifyUserOptions): Promise<void> {
  const { userId, title, body, ctaUrl, type = "WORKFLOW_TASK" } = opts;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      displayName: true,
      email: true,
      phone: true,
      notifyChannel: true,
    },
  });

  if (!user) {
    logger.warn("notifyUser: user not found", { userId });
    return;
  }

  // 1. Always write the in-app row first — it's the source of truth.
  try {
    await db.notification.create({
      data: { userId, type, title, body, linkUrl: ctaUrl ?? null },
    });
  } catch (error) {
    logger.error("notifyUser: failed to write Notification row", error, { userId });
  }

  const channel = resolveChannel(user.notifyChannel);
  const recipientName = user.displayName ?? user.name ?? "User";
  const wantsEmail = channel === "EMAIL" || channel === "ALL";
  const wantsSms = channel === "SMS" || channel === "ALL";
  const wantsWhatsApp = channel === "WHATSAPP" || channel === "ALL";

  // 2. Email
  if (wantsEmail && user.email) {
    try {
      await sendMail({
        to: user.email,
        subject: title,
        react: React.createElement(WorkflowNotification, {
          recipientName,
          subject: title,
          body,
          ...(ctaUrl ? { cta: { label: "Open task", url: ctaUrl } } : {}),
        }),
      });
    } catch (error) {
      logger.error("notifyUser: email failed", error, { userId });
    }
  }

  const shortBody = compactBody(title, body);

  // 3. SMS
  if (wantsSms && user.phone) {
    try {
      await sendSms({ to: user.phone, message: shortBody });
    } catch (error) {
      logger.error("notifyUser: sms failed", error, { userId });
    }
  }

  // 4. WhatsApp — gated on env (feature flag) AND user having a phone number.
  if (wantsWhatsApp && user.phone && whatsappEnabled()) {
    try {
      if (opts.whatsappTemplate) {
        await sendWhatsAppText({
          toPhone: user.phone,
          templateName: opts.whatsappTemplate,
          templateLang: opts.whatsappTemplateLang,
          templateVariables: opts.whatsappTemplateVariables ?? [recipientName, title],
        });
      } else {
        // Best-effort: only succeeds inside an open 24h session window.
        // Meta rejects free-text otherwise — we log+continue.
        await sendWhatsAppText({ toPhone: user.phone, body: shortBody });
      }
    } catch (error) {
      logger.error("notifyUser: whatsapp failed", error, { userId });
    }
  }
}
