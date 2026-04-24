import { NextRequest, NextResponse } from "next/server";
import * as React from "react";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { take, PASSWORD_RESET_RATE_LIMIT } from "@/lib/rate-limit";
import { revokeAllUserSessions } from "@/lib/sessions";
import PasswordResetOtpEmail from "@/emails/password-reset-otp";

const OTP_VALIDITY_HOURS = 24;
/** Length of the random part of the OTP (in characters). */
const OTP_RANDOM_LEN = 6;
/** Characters allowed in the OTP — excludes look-alikes (0/O, 1/I, etc). */
const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateOtp(): string {
  let raw = "";
  const buf = crypto.randomBytes(OTP_RANDOM_LEN);
  for (let i = 0; i < OTP_RANDOM_LEN; i++) {
    raw += OTP_ALPHABET[buf[i] % OTP_ALPHABET.length];
  }
  // Format as KU-XXXXXX so the user knows it's not a normal password
  return `KU-${raw}`;
}

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Admin-only. Generates a one-time password, replaces the user's password
 * hash with bcrypt(OTP), sets `mustChangePassword=true`, sets
 * `passwordResetExpiresAt`, emails the OTP to the user via the branded
 * EDRMS template, and returns the plaintext OTP to the admin so they can
 * communicate it directly if email is unreliable.
 *
 * Body: { note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Per-admin rate limit so a runaway script can't spam OTP emails.
    const rl = take(
      `pwd-reset:${session.user.id}`,
      PASSWORD_RESET_RATE_LIMIT.max,
      PASSWORD_RESET_RATE_LIMIT.windowMs,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Too many resets in a short window. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const note = (body.note ?? "").trim() || undefined;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        name: true,
        isActive: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!user.isActive) {
      return NextResponse.json(
        { error: "Reactivate the account before resetting its password." },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 12);
    const expiresAt = new Date(Date.now() + OTP_VALIDITY_HOURS * 60 * 60 * 1000);

    await db.user.update({
      where: { id },
      data: {
        password: otpHash,
        mustChangePassword: true,
        passwordResetExpiresAt: expiresAt,
      },
    });

    // Force-logout any sessions the user might have on other devices —
    // their previous password is gone.
    await revokeAllUserSessions(id, "PASSWORD_CHANGED").catch(() => null);

    // Best-effort email — don't fail the reset if SMTP isn't configured.
    let emailSent = false;
    if (user.email) {
      const baseUrl =
        process.env.APP_URL ??
        process.env.NEXTAUTH_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        "https://edrms.karu.ac.ke";
      try {
        emailSent = await sendMail({
          to: user.email,
          subject: "Your EDRMS password has been reset",
          react: React.createElement(PasswordResetOtpEmail, {
            recipientName: user.displayName ?? user.name ?? "Colleague",
            otp,
            initiatedByName:
              session.user.name ?? session.user.email ?? "An administrator",
            validityHours: OTP_VALIDITY_HOURS,
            loginUrl: `${baseUrl}/login`,
            note,
          }),
        });
      } catch (err) {
        logger.error("Failed to send password reset email", err, {
          userId: id,
        });
      }
    }

    await writeAudit({
      userId: session.user.id,
      action: "USER_PASSWORD_RESET_INITIATED",
      resourceType: "user",
      resourceId: id,
      metadata: {
        emailSent,
        validityHours: OTP_VALIDITY_HOURS,
        targetEmail: user.email,
      },
    });

    return NextResponse.json({
      success: true,
      // Sent to the admin so they can read it out / put it on a sticky note
      // if email delivery is delayed. Lifetime is bound by passwordResetExpiresAt.
      otp,
      validityHours: OTP_VALIDITY_HOURS,
      expiresAt: expiresAt.toISOString(),
      emailSent,
    });
  } catch (error) {
    logger.error("Failed to reset user password", error, {
      route: "/api/admin/users/[id]/reset-password",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
