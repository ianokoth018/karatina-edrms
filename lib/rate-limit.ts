/**
 * In-memory rate limiter for sensitive auth endpoints.
 *
 * Single-instance only — for multi-instance deployments swap this for a
 * Redis-backed counter. The shape is designed so swapping is a one-line
 * change to the body of `take()`.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Atomically check-and-increment a bucket. Buckets reset after `windowMs`.
 *
 * @param key      A composite key like "login:127.0.0.1:user@example.com"
 * @param max      Maximum allowed in the window
 * @param windowMs Window size in milliseconds
 */
export function take(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: max - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Reset a bucket — call on a successful action so we don't penalise hits after recovery. */
export function reset(key: string): void {
  buckets.delete(key);
}

// ---- Pre-configured policies ----
export const LOGIN_RATE_LIMIT = { max: 10, windowMs: 60 * 1000 }; // 10/min/IP
export const MFA_RATE_LIMIT = { max: 8, windowMs: 60 * 1000 }; // 8/min/user
export const PASSWORD_RESET_RATE_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 }; // 3/hour/admin

// Periodic cleanup so the map doesn't grow unbounded.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, 5 * 60 * 1000).unref?.();
}
