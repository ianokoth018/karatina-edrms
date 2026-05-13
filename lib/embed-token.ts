import crypto from "crypto";

/**
 * Stateless signed tokens used by the embedded document viewer.
 *
 * Token format: `${base64url(payload)}.${base64url(hmac)}`. Payload is JSON
 * `{ d, u, exp }` (documentId, userId, expiry ms). HMAC is computed with
 * EMBED_TOKEN_SECRET / AUTH_SECRET so verification is DB-free.
 *
 * Mirrors the pattern in lib/memo-share.ts; kept separate because the
 * lifetimes and payload shape differ.
 */
const SECRET =
  process.env.EMBED_TOKEN_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "fallback-insecure-embed-token-secret";

const DEFAULT_TTL_SECONDS = 15 * 60;

interface Payload {
  d: string;
  u: string;
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

export function createDocEmbedToken(
  documentId: string,
  userId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): { token: string; expiresAt: Date } {
  const expMs = Date.now() + ttlSeconds * 1000;
  const payload: Payload = { d: documentId, u: userId, exp: expMs };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: new Date(expMs) };
}

export function verifyDocEmbedToken(
  token: string
):
  | { ok: true; documentId: string; userId: string; exp: number }
  | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Malformed token" };
  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64);
  if (
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return { ok: false, reason: "Signature mismatch" };
  }
  let payload: Payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "Malformed payload" };
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return { ok: false, reason: "Token expired" };
  }
  if (!payload.d || !payload.u) {
    return { ok: false, reason: "Missing fields" };
  }
  return { ok: true, documentId: payload.d, userId: payload.u, exp: payload.exp };
}
