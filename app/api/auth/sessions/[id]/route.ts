import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { revokeSession } from "@/lib/sessions";

/**
 * DELETE /api/auth/sessions/[id] — revoke one of the caller's own sessions.
 * Owners only — admins use a different endpoint. Used by the "Sign out
 * other devices" flow on the profile page.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const target = await db.userSession.findUnique({
      where: { id },
      select: { userId: true, revokedAt: true },
    });
    if (!target || target.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!target.revokedAt) {
      await revokeSession(id, "USER_LOGOUT");
      await writeAudit({
        userId: session.user.id,
        action: "USER_SESSION_REVOKED",
        resourceType: "user_session",
        resourceId: id,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to revoke session", error, {
      route: "/api/auth/sessions/[id]",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
