import { NextResponse } from "next/server";
import * as React from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { issueOtp, OTP_TTL_MIN } from "@/lib/login-otp";
import { take, MFA_RATE_LIMIT } from "@/lib/rate-limit";
import LoginOtpEmail from "@/emails/login-otp";

/**
 * POST /api/auth/mfa/setup
 *
 * First step of enabling email Two-Factor Authentication. Issues a
 * verification code and emails it to the user. The user then submits
 * that code to /api/auth/mfa/enable to flip `mfaEnabled` on.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = take(
      `mfa-setup:${session.user.id}`,
      MFA_RATE_LIMIT.max,
      MFA_RATE_LIMIT.windowMs,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, displayName: true, name: true },
    });
    if (!user?.email) {
      return NextResponse.json(
        { error: "Your account has no email address — contact an administrator." },
        { status: 400 },
      );
    }

    const { code, expiresAt } = await issueOtp(user.id, "MFA_VERIFY");

    let emailSent = false;
    try {
      emailSent = await sendMail({
        to: user.email,
        subject: "Confirm Two-Factor Authentication",
        react: React.createElement(LoginOtpEmail, {
          recipientName: user.displayName ?? user.name ?? "Colleague",
          otp: code,
          validityMinutes: OTP_TTL_MIN,
          purpose: "MFA_VERIFY",
        }),
      });
    } catch (err) {
      logger.error("Failed to deliver MFA-verify code", err, { userId: user.id });
    }

    return NextResponse.json({
      success: true,
      emailSent,
      maskedEmail: maskEmail(user.email),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error("Failed to start MFA setup", error, {
      route: "/api/auth/mfa/setup",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
  const masked = head + "•".repeat(Math.max(2, local.length - head.length));
  return `${masked}@${domain}`;
}
