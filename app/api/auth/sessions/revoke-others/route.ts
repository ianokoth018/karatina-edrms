import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { revokeOtherUserSessions } from "@/lib/sessions";

/**
 * POST /api/auth/sessions/revoke-others — sign the caller out everywhere
 * except the device they're currently using.
 *
 * The "current" session is heuristically the most recently touched
 * session row for this user (the one that just made this request).
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const current = await db.userSession.findFirst({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { lastActiveAt: "desc" },
      select: { id: true },
    });
    if (!current) {
      return NextResponse.json({ error: "No active session found" }, { status: 404 });
    }

    const count = await revokeOtherUserSessions(session.user.id, current.id);

    await writeAudit({
      userId: session.user.id,
      action: "USER_SESSION_REVOKED_OTHERS",
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { revokedCount: count },
    });

    return NextResponse.json({ success: true, revoked: count });
  } catch (error) {
    logger.error("Failed to revoke other sessions", error, {
      route: "/api/auth/sessions/revoke-others",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
