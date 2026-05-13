import crypto from "crypto";

/**
 * Stateless signed room-tokens for the realtime (Yjs) WebSocket server.
 *
 * Format: `${base64url(payload)}.${base64url(hmac)}`
 *
 * Payload: JSON `{ room, userId, exp }` where `room` is the Yjs room name,
 * `userId` is the originating user (for audit / future ACLs), and `exp` is a
 * Unix-ms expiry. The HMAC is bound to `room` — a token issued for one
 * document can't be replayed against another. Verification needs no DB
 * lookup, so the standalone `scripts/realtime-server.ts` process can run
 * without a Prisma client.
 *
 * Mirrors the recipe in `lib/memo-share.ts`.
 */

const SECRET =
  process.env.REALTIME_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "fallback-insecure-realtime-secret";

const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

interface TokenPayload {
  room: string;
  userId: string;
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

export interface CreatedToken {
  token: string;
  expiresAt: number; // Unix-ms
}

export function createRoomToken(
  room: string,
  userId: string,
  ttlSec: number = DEFAULT_TTL_SEC
): CreatedToken {
  const expiresAt = Date.now() + ttlSec * 1000;
  const payload: TokenPayload = { room, userId, exp: expiresAt };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

export type VerifyResult =
  | { ok: true; userId: string; expiresAt: number }
  | { ok: false; reason: string };

/**
 * Verify a token presented by a WebSocket connecting to `room`.
 * The token's payload `room` field must match the room we're joining —
 * otherwise an attacker who scraped a token for doc A could join doc B.
 */
export function verifyRoomToken(token: string, room: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);

  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return { ok: false, reason: "bad-signature" };
  }

  try {
    const payload = JSON.parse(
      b64urlDecode(payloadB64).toString("utf8")
    ) as TokenPayload;
    if (
      typeof payload.room !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return { ok: false, reason: "bad-payload" };
    }
    if (payload.room !== room) return { ok: false, reason: "wrong-room" };
    if (payload.exp < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, userId: payload.userId, expiresAt: payload.exp };
  } catch {
    return { ok: false, reason: "bad-payload" };
  }
}
