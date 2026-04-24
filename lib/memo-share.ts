import crypto from "crypto";

/**
 * Stateless signed share-tokens for circulated memos.
 *
 * Token format: `${base64url(payload)}.${base64url(hmac)}`
 *
 * Payload: JSON `{ id, exp }` where `id` is the memo (workflow instance) id
 * and `exp` is a Unix-ms expiry. The HMAC is computed with `MEMO_SHARE_SECRET`
 * (or the NextAuth secret as a fallback) so verification needs no DB lookup.
 */

const SECRET =
  process.env.MEMO_SHARE_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "fallback-insecure-memo-share-secret";

const DEFAULT_TTL_DAYS = 90;

interface TokenPayload {
  id: string;
  exp: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string): string {
  return b64urlEncode(
    crypto.createHmac("sha256", SECRET).update(payloadB64).digest()
  );
}

export function createMemoShareToken(memoId: string, ttlDays = DEFAULT_TTL_DAYS): string {
  const payload: TokenPayload = {
    id: memoId,
    exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyMemoShareToken(
  token: string
): { ok: true; memoId: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Malformed token" };

  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);

  // Constant-time compare
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return { ok: false, reason: "Invalid signature" };
  }

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as TokenPayload;
    if (typeof payload.id !== "string" || typeof payload.exp !== "number") {
      return { ok: false, reason: "Invalid payload" };
    }
    if (payload.exp < Date.now()) return { ok: false, reason: "Token expired" };
    return { ok: true, memoId: payload.id };
  } catch {
    return { ok: false, reason: "Invalid payload" };
  }
}
