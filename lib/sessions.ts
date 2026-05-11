import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * Server-side session ledger for the JWT auth strategy.
 *
 * Every issued refresh token is stored as `UserSession`. The `jwt()`
 * callback in lib/auth checks this table on every refresh, so we can
 * forcefully invalidate a session at any time (sign-out, password change,
 * admin revoke, MFA disable, etc.).
 *
 * Refresh tokens are UUIDs (128-bit random) — they don't need bcrypt's
 * slow key-derivation. We use HMAC-SHA256 instead: instant to compute,
 * timing-safe to compare, and more than sufficient for a high-entropy
 * random value. This also eliminates the ~100ms bcrypt window that was
 * causing a race condition when concurrent requests all hit token rotation
 * at the same moment, resulting in unexpected logouts.
 */

const HMAC_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

function hashToken(token: string): string {
  return createHmac("sha256", HMAC_SECRET).update(token).digest("hex");
}

function verifyToken(token: string, storedHash: string): boolean {
  const computed = hashToken(token);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}

export type RevokeReason =
  | "USER_LOGOUT"
  | "PASSWORD_CHANGED"
  | "ADMIN_REVOKED"
  | "REVOKED_OTHER_DEVICES"
  | "EXPIRED"
  | "MFA_DISABLED";

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Create a new server-side session row when a user signs in. Returns the
 * session id which is embedded in the JWT for fast lookup later.
 */
export async function createSession(
  userId: string,
  refreshToken: string,
  expiresAt: Date,
  ctx: SessionContext = {},
): Promise<string> {
  const row = await db.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Verify a session by id + refresh token.
 *
 * Returns:
 *   "valid"    — session exists, not revoked, not expired, token matches
 *   "revoked"  — session was explicitly revoked (logout, admin, etc.)
 *   "expired"  — session row is past its expiresAt
 *   "notFound" — no row with this id
 *   "raced"    — session is alive but hash doesn't match; another concurrent
 *                request already rotated this token. Caller should extend the
 *                access token without rotating rather than treating this as an
 *                auth failure.
 */
export type SessionVerifyResult = "valid" | "revoked" | "expired" | "notFound" | "raced";

export async function verifyAndTouchSession(
  sessionId: string,
  refreshToken: string,
): Promise<SessionVerifyResult> {
  const sess = await db.userSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      refreshTokenHash: true,
      revokedAt: true,
      expiresAt: true,
      lastActiveAt: true,
    },
  });

  if (!sess) return "notFound";
  if (sess.revokedAt) return "revoked";
  if (sess.expiresAt.getTime() < Date.now()) return "expired";

  if (!verifyToken(refreshToken, sess.refreshTokenHash)) {
    // The session row is alive but the hash doesn't match. This typically
    // means a concurrent request already rotated the refresh token a few
    // milliseconds before us. Treat it as a race rather than a hard failure
    // so the user isn't unexpectedly logged out.
    const lastActive = sess.lastActiveAt?.getTime() ?? 0;
    const racedRecently = Date.now() - lastActive < 30_000; // 30-second grace window
    return racedRecently ? "raced" : "notFound";
  }

  // Best-effort touch — never fail the request if the update fails.
  db.userSession
    .update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } })
    .catch(() => null);

  return "valid";
}

/**
 * Rotate the refresh token on a session row (called when the access token
 * is refreshed). Updates the hash + expiry atomically.
 */
export async function rotateSessionToken(
  sessionId: string,
  newToken: string,
  newExpiresAt: Date,
): Promise<void> {
  await db.userSession.update({
    where: { id: sessionId },
    data: {
      refreshTokenHash: hashToken(newToken),
      expiresAt: newExpiresAt,
      lastActiveAt: new Date(),
    },
  });
}

/** Mark a single session as revoked. */
export async function revokeSession(
  sessionId: string,
  reason: RevokeReason,
): Promise<void> {
  await db.userSession
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch(() => null);
}

/** Revoke every active session belonging to a user. */
export async function revokeAllUserSessions(
  userId: string,
  reason: RevokeReason,
): Promise<number> {
  const result = await db.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/** Revoke every active session for a user EXCEPT the current one. */
export async function revokeOtherUserSessions(
  userId: string,
  keepSessionId: string,
  reason: RevokeReason = "REVOKED_OTHER_DEVICES",
): Promise<number> {
  const result = await db.userSession.updateMany({
    where: { userId, revokedAt: null, NOT: { id: keepSessionId } },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}
