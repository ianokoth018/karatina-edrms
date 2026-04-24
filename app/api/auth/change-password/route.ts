import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import {
  validatePasswordStrength,
  isPasswordReused,
  appendPasswordHistory,
  PASSWORD_HISTORY_KEEP,
} from "@/lib/auth-policy";
import { revokeAllUserSessions } from "@/lib/sessions";

/**
 * POST /api/auth/change-password
 *
 * Body: { currentPassword: string, newPassword: string }
 *
 * Validates the current password (which may be the admin-issued OTP),
 * then writes the new bcrypt hash and clears `mustChangePassword`.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const currentPassword = (body.currentPassword ?? "").trim();
    const newPassword = body.newPassword ?? "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new passwords are required." },
        { status: 400 }
      );
    }

    const policyError = validatePasswordStrength(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current one." },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        password: true,
        passwordHistory: true,
        mustChangePassword: true,
        passwordResetExpiresAt: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If a forced reset is active, the OTP must still be unexpired.
    if (
      user.mustChangePassword &&
      user.passwordResetExpiresAt &&
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      return NextResponse.json(
        { error: "Your reset link has expired. Ask an admin for a new one." },
        { status: 403 }
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 401 }
      );
    }

    // Reject reuse of any of the last N passwords.
    if (await isPasswordReused(newPassword, user.passwordHistory)) {
      return NextResponse.json(
        {
          error: `You can't reuse one of your last ${PASSWORD_HISTORY_KEEP} passwords.`,
        },
        { status: 400 },
      );
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const newHistory = appendPasswordHistory(user.passwordHistory, user.password);
    await db.user.update({
      where: { id: user.id },
      data: {
        password: newHash,
        passwordHistory: newHistory,
        mustChangePassword: false,
        passwordResetExpiresAt: null,
        passwordChangedAt: new Date(),
        // Reset any pending lockout when the user successfully rotates.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    // Force all other sessions to log out — a password change should
    // invalidate any device that might still have a stale refresh token.
    await revokeAllUserSessions(user.id, "PASSWORD_CHANGED").catch(() => null);

    await writeAudit({
      userId: user.id,
      action: "USER_PASSWORD_CHANGED",
      resourceType: "user",
      resourceId: user.id,
      metadata: { wasForced: user.mustChangePassword },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to change password", error, {
      route: "/api/auth/change-password",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
