import { NextResponse } from "next/server";
import { take } from "@/lib/rate-limit";

/**
 * Admin-endpoint rate-limit policy: 60 requests / minute, keyed by the
 * authenticated user id + pathname. Returns a ready-to-send `NextResponse`
 * (429 with `Retry-After`) when the caller has exceeded the bucket, or
 * `null` when the request is within the limit.
 *
 * Admin endpoints opt-in by calling this immediately after the
 * `admin:manage` permission check — the proxy intentionally does not
 * auto-enforce.
 */
const ADMIN_RATE_LIMIT_MAX = 60;
const ADMIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function enforceAdminRateLimit(
  req: Request,
  session: { user?: { id?: string } },
): Promise<NextResponse | null> {
  const userId = session?.user?.id ?? "anonymous";
  let pathname = "unknown";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    /* fall through with "unknown" */
  }

  const key = `admin:${userId}:${pathname}`;
  const result = take(key, ADMIN_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_WINDOW_MS);

  if (result.allowed) return null;

  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}
