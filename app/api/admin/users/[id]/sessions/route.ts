import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { revokeAllUserSessions } from "@/lib/sessions";

/**
 * GET /api/admin/users/[id]/sessions — list a user's active sessions.
 * DELETE — revoke ALL of a user's active sessions.
 *
 * Both admin-only.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.user.permissions?.includes("admin:manage")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: session.user.id };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const { id } = await params;

    const sessions = await db.userSession.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
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

    return NextResponse.json({ sessions });
  } catch (error) {
    logger.error("Failed to list user sessions", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const { id } = await params;

    const count = await revokeAllUserSessions(id, "ADMIN_REVOKED");

    await writeAudit({
      userId: guard.adminId!,
      action: "ADMIN_REVOKED_USER_SESSIONS",
      resourceType: "user",
      resourceId: id,
      metadata: { revokedCount: count },
    });

    return NextResponse.json({ success: true, revoked: count });
  } catch (error) {
    logger.error("Failed to revoke user sessions", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
