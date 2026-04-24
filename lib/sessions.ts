import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * Server-side session ledger for the JWT auth strategy.
 *
 * Every issued refresh token is stored as `UserSession`. The `jwt()`
 * callback in lib/auth checks this table on every refresh, so we can
 * forcefully invalidate a session at any time (sign-out, password change,
 * admin revoke, MFA disable, etc.).
 */

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
  const hash = await bcrypt.hash(refreshToken, 10);
  const row = await db.userSession.create({
    data: {
      userId,
      refreshTokenHash: hash,
      expiresAt,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Verify a session by id + refresh token. Returns true if the session is
 * present, not revoked, not expired, and the token matches. Updates
 * `lastActiveAt` as a side effect.
 */
export async function verifyAndTouchSession(
  sessionId: string,
  refreshToken: string,
): Promise<boolean> {
  const sess = await db.userSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      refreshTokenHash: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!sess) return false;
  if (sess.revokedAt) return false;
  if (sess.expiresAt.getTime() < Date.now()) return false;
  if (!(await bcrypt.compare(refreshToken, sess.refreshTokenHash))) return false;

  // Best-effort touch — never fail the request if the update fails.
  db.userSession
    .update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } })
    .catch(() => null);
  return true;
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
  const hash = await bcrypt.hash(newToken, 10);
  await db.userSession.update({
    where: { id: sessionId },
    data: {
      refreshTokenHash: hash,
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
