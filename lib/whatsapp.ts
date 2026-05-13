import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// WhatsApp Cloud API (Meta) — REST helper.
//
// We deliberately don't take a dependency on `whatsapp-cloud-api` or any
// other SDK. The Cloud API is plain JSON over HTTPS, and Node's built-in
// fetch is plenty. This keeps the dependency surface small and the helper
// trivially mockable.
//
// Required env (no defaults — without these, whatsappEnabled() returns false):
//   WHATSAPP_PHONE_NUMBER_ID      — the sender phone number's Cloud API id
//   WHATSAPP_ACCESS_TOKEN         — long-lived system-user token with
//                                   `whatsapp_business_messaging` scope.
//
// Optional env:
//   WHATSAPP_BUSINESS_ACCOUNT_ID  — only needed by tooling that lists or
//                                   registers templates. Sending doesn't
//                                   need it.
//   WHATSAPP_GRAPH_VERSION        — defaults to "v20.0".
//
// ## 24-hour session window (Meta policy)
// A business can only send free-text ("text") messages to a user inside a
// 24h window that *the user* opens by sending a message in. Outside that
// window — including the very first contact — only pre-approved template
// messages are allowed. Callers should default to templates for unsolicited
// alerts (SLA breaches, task assignments) and only use raw text when they
// know the user is in an active session (e.g. a reply to a recent inbound).
// ---------------------------------------------------------------------------

function getGraphVersion(): string {
  return process.env.WHATSAPP_GRAPH_VERSION || "v20.0";
}

/** Cheap env check. Safe to call on every request. */
export function whatsappEnabled(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Normalise to E.164 *without* leading `+` — Meta's API rejects the plus
 * but otherwise expects full international format. Mirrors `lib/sms.ts`'s
 * "drop leading 0, prefix country code" heuristic for Kenya.
 */
function normalisePhone(raw: string): string {
  let n = raw.trim();
  if (n.startsWith("+")) n = n.slice(1);
  // Local Kenyan format (07XX… / 01XX…) → 254XX…
  if (n.startsWith("0")) n = `254${n.slice(1)}`;
  // Strip any spaces/dashes
  return n.replace(/[\s-]/g, "");
}

export interface WhatsAppSendOptions {
  toPhone: string;
  /** Free-text body. Required when no `templateName` is supplied. */
  body?: string;
  /** Approved template name (preferred for first-touch / out-of-session). */
  templateName?: string;
  /** BCP-47 language code — defaults to "en". */
  templateLang?: string;
  /** Positional `{{1}}`, `{{2}}` … variables for the template body. */
  templateVariables?: string[];
}

export interface WhatsAppSendResult {
  ok: boolean;
  /** wamid from Meta (message id) on success. */
  id?: string;
  error?: string;
}

/**
 * Send a single WhatsApp message via the Cloud API.
 *
 * If `templateName` is supplied a `template` message is sent (works any time,
 * but the template must be pre-approved in Meta Business Manager).
 * Otherwise a `text` message is sent — only valid inside an active 24h
 * session window (see file header).
 *
 * Never throws — callers can treat WhatsApp like SMS / email and fall back
 * cleanly when delivery fails.
 */
export async function sendWhatsAppText(opts: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    logger.debug("WhatsApp not configured — skipping");
    return { ok: false, error: "not_configured" };
  }

  const to = normalisePhone(opts.toPhone);
  if (!to) return { ok: false, error: "invalid_phone" };

  // Build the message payload. Meta's spec:
  //   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
  let payload: Record<string, unknown>;
  if (opts.templateName) {
    const components = opts.templateVariables?.length
      ? [
          {
            type: "body",
            parameters: opts.templateVariables.map((v) => ({ type: "text", text: v })),
          },
        ]
      : undefined;
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.templateLang || "en" },
        ...(components ? { components } : {}),
      },
    };
  } else {
    if (!opts.body) return { ok: false, error: "missing_body" };
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      // preview_url=false keeps Meta from auto-fetching link previews
      // (faster delivery, no surprise outbound HTTP from their servers).
      text: { preview_url: false, body: opts.body },
    };
  }

  const url = `https://graph.facebook.com/${getGraphVersion()}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as
      | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
      | null;

    if (!res.ok) {
      const errMsg = json?.error?.message || `HTTP ${res.status}`;
      logger.warn("WhatsApp send failed", { to, error: errMsg, code: json?.error?.code });
      return { ok: false, error: errMsg };
    }

    const id = json?.messages?.[0]?.id;
    logger.info("WhatsApp sent", { to, id });
    return { ok: true, id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    logger.error("WhatsApp send threw", err, { to });
    return { ok: false, error: msg };
  }
}

/**
 * Masked Phone Number Id for the admin UI — only show first/last 4 chars
 * so screenshots / logs don't leak the whole identifier.
 */
export function maskedPhoneNumberId(): string | null {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) return null;
  if (id.length <= 8) return "••••";
  return `${id.slice(0, 4)}••••${id.slice(-4)}`;
}
