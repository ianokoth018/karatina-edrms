import { NextRequest, NextResponse } from "next/server";
import * as React from "react";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { issueOtp, OTP_TTL_MIN, type OtpPurpose } from "@/lib/login-otp";
import { take, MFA_RATE_LIMIT } from "@/lib/rate-limit";
import LoginOtpEmail from "@/emails/login-otp";

/**
 * POST /api/auth/mfa/request-code
 *
 * Public endpoint that re-validates the user's email + password and, on
 * success, emails a one-time code that NextAuth's authorize() callback
 * will accept on the next /signin call.
 *
 * Body: { email: string, password: string, purpose?: "LOGIN" | "MFA_VERIFY" }
 *
 * Always returns 200 to avoid disclosing which emails exist; SMTP delivery
 * is best-effort. Heavy-handed rate limit per (IP, email).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      password?: string;
      purpose?: OtpPurpose;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const purpose: OtpPurpose = body.purpose === "MFA_VERIFY" ? "MFA_VERIFY" : "LOGIN";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = take(`otp:${ip}:${email}`, MFA_RATE_LIMIT.max, MFA_RATE_LIMIT.windowMs);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many code requests. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        password: true,
        email: true,
        displayName: true,
        name: true,
        isActive: true,
        mfaEnabled: true,
        mustChangePassword: true,
      },
    });

    // Constant-time-ish error: do the bcrypt anyway so timing doesn't leak.
    const dummyHash = "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
    const ok = await bcrypt.compare(
      password,
      user?.password ?? dummyHash,
    );

    if (!user || !ok || !user.isActive) {
      return NextResponse.json({ success: true, sent: false });
    }

    // No need to issue an OTP at all if MFA isn't enabled — the login form
    // will succeed without one. Tell the client so it can skip the OTP step.
    if (purpose === "LOGIN" && !user.mfaEnabled) {
      return NextResponse.json({ success: true, mfaRequired: false });
    }

    const { code, expiresAt } = await issueOtp(user.id, purpose);

    if (user.email) {
      try {
        await sendMail({
          to: user.email,
          subject:
            purpose === "MFA_VERIFY"
              ? "Confirm Two-Factor Authentication"
              : "Your EDRMS sign-in code",
          react: React.createElement(LoginOtpEmail, {
            recipientName: user.displayName ?? user.name ?? "Colleague",
            otp: code,
            validityMinutes: OTP_TTL_MIN,
            purpose,
            requestIp: ip !== "unknown" ? ip : undefined,
          }),
        });
      } catch (err) {
        logger.error("Failed to deliver login OTP email", err, { userId: user.id });
      }
    }

    return NextResponse.json({
      success: true,
      mfaRequired: true,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error("Failed to issue login OTP", error, {
      route: "/api/auth/mfa/request-code",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
