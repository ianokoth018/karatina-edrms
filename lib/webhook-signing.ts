import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Outbound webhook signing helper.
 *
 * Signature scheme: HMAC-SHA256(`${timestamp}.${body}`) hex-encoded, where
 * `timestamp` is the millisecond epoch at signing time. Receivers should
 * reject any payload whose timestamp lies outside a tolerance window
 * (default: 5 minutes) to defeat replay attacks.
 */

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export interface SignedWebhook {
  signature: string;
  timestamp: number;
}

/**
 * Compute an HMAC-SHA256 signature over `${timestamp}.${body}` using the
 * given shared secret. Returns the hex signature and the timestamp that
 * was signed; both must be transmitted alongside the request body so the
 * receiver can recompute and verify.
 */
export function signWebhookPayload(body: string, secret: string): SignedWebhook {
  const timestamp = Date.now();
  const signature = computeSignature(body, secret, timestamp);
  return { signature, timestamp };
}

export interface VerifyWebhookOptions {
  body: string;
  signature: string;
  timestamp: number;
  secret: string;
  /** Maximum age of the signed timestamp, in ms. Defaults to 5 minutes. */
  toleranceMs?: number;
}

/**
 * Symmetric verifier for {@link signWebhookPayload}. Returns true iff the
 * timestamp is within `toleranceMs` of now AND the signature matches a
 * freshly-computed HMAC over `${timestamp}.${body}` using `secret`.
 *
 * Uses {@link timingSafeEqual} so callers cannot probe the secret via
 * timing side-channels.
 */
export function verifyWebhookSignature(opts: VerifyWebhookOptions): boolean {
  const {
    body,
    signature,
    timestamp,
    secret,
    toleranceMs = DEFAULT_TOLERANCE_MS,
  } = opts;

  if (!Number.isFinite(timestamp)) return false;
  const skew = Math.abs(Date.now() - timestamp);
  if (skew > toleranceMs) return false;

  const expected = computeSignature(body, secret, timestamp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function computeSignature(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}
