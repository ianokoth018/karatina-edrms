import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { revokeAllUserSessions } from "@/lib/sessions";

/**
 * POST /api/auth/mfa/disable
 *
 * Body: { password: string } — the user's current password is required to
 * disable MFA. This guards against an attacker with a hijacked session
 * disabling the second factor.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password } = (await req.json()) as { password?: string };
    if (!password) {
      return NextResponse.json(
        { error: "Confirm with your current password." },
        { status: 400 },
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { password: true, mfaEnabled: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return NextResponse.json(
        { error: "That password is not correct." },
        { status: 401 },
      );
    }

    await db.user.update({
      where: { id: session.user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
      },
    });

    // Force all other sessions to log out — disabling a second factor is
    // a meaningful security event and we shouldn't let stale tokens linger.
    await revokeAllUserSessions(session.user.id, "MFA_DISABLED").catch(() => null);

    await writeAudit({
      userId: session.user.id,
      action: "USER_MFA_DISABLED",
      resourceType: "user",
      resourceId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to disable MFA", error, { route: "/api/auth/mfa/disable" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
