import bcrypt from "bcryptjs";

/**
 * Authentication policy: lockout, password rules, password history.
 *
 * These are intentionally simple rules expressed in code (not in a
 * settings table) so they're versioned with the source and easy to audit.
 */

// ---------- Account lockout ----------
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MIN = 15;

// ---------- Password expiry ----------
/** Force a password change after this many days. 0 disables. */
export const PASSWORD_MAX_AGE_DAYS = 90;

export function isPasswordExpired(passwordChangedAt: Date | null): boolean {
  if (PASSWORD_MAX_AGE_DAYS <= 0) return false;
  if (!passwordChangedAt) return false; // unknown — don't lock people out
  const ageMs = Date.now() - passwordChangedAt.getTime();
  return ageMs > PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export function isLocked(lockedUntil: Date | null): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

export function lockoutEndsAt(): Date {
  return new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000);
}

export function shouldLockAfterFailure(currentAttempts: number): boolean {
  // currentAttempts here is BEFORE incrementing — i.e. lock once we cross
  // the threshold (5th failure locks).
  return currentAttempts + 1 >= MAX_FAILED_ATTEMPTS;
}

// ---------- Password policy ----------
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_HISTORY_KEEP = 5;

/**
 * Returns null if the password is acceptable, else a human-readable reason.
 * Slightly stricter than the change-password route's old policy: 10 chars,
 * upper + lower + digit, plus length cap.
 */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > 128) return "Password is too long.";
  if (!/[a-z]/.test(pw)) return "Password must contain a lower-case letter.";
  if (!/[A-Z]/.test(pw)) return "Password must contain an upper-case letter.";
  if (!/\d/.test(pw)) return "Password must contain a digit.";
  // Reject the most obvious weak passwords without bringing in a dictionary.
  const weak = ["password", "12345678", "qwertyui", "letmein", "karatina"];
  if (weak.some((w) => pw.toLowerCase().includes(w)))
    return "That password is too common — try something less obvious.";
  return null;
}

/**
 * Check whether `candidate` was used recently. Returns true if it matches
 * any hash in `history`. `history` is the user's `passwordHistory` JSON
 * column (an array of bcrypt hashes).
 */
export async function isPasswordReused(
  candidate: string,
  history: unknown,
): Promise<boolean> {
  if (!Array.isArray(history)) return false;
  for (const h of history) {
    if (typeof h !== "string") continue;
    try {
      if (await bcrypt.compare(candidate, h)) return true;
    } catch {
      /* corrupt history entry — skip */
    }
  }
  return false;
}

/**
 * Push a fresh hash onto the history array, trimming to the last N.
 */
export function appendPasswordHistory(
  history: unknown,
  newHash: string,
): string[] {
  const arr = Array.isArray(history)
    ? (history.filter((h): h is string => typeof h === "string") as string[])
    : [];
  arr.unshift(newHash);
  return arr.slice(0, PASSWORD_HISTORY_KEEP);
}
