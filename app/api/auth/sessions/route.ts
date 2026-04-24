import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/auth/sessions
 *
 * Returns the caller's currently active sessions (revokedAt = null).
 * The session row that owns the current request is marked `current: true`.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Pull sessionId from the JWT cookie indirectly — it's surfaced in
    // session.error if invalid; the active token has it embedded but we
    // can't read it from auth() directly. We mark "current" via best-effort
    // by comparing with the most recently active session for this user.
    const active = await db.userSession.findMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastActiveAt: "desc" },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    // Heuristic: the most recently touched session in the last 60s is "current".
    const now = Date.now();
    const sessions = active.map((s, idx) => ({
      ...s,
      current: idx === 0 && now - s.lastActiveAt.getTime() < 60_000,
    }));

    return NextResponse.json({ sessions });
  } catch (error) {
    logger.error("Failed to list user sessions", error, {
      route: "/api/auth/sessions",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
