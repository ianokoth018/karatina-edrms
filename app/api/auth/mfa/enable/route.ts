import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { verifyOtp } from "@/lib/login-otp";
import { take, MFA_RATE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/auth/mfa/enable
 *
 * Verifies the 6-digit code that /api/auth/mfa/setup just emailed.
 * On success the user's `mfaEnabled` flag is flipped to true; from now
 * on every sign-in will require an emailed code.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = take(
      `mfa-enable:${session.user.id}`,
      MFA_RATE_LIMIT.max,
      MFA_RATE_LIMIT.windowMs,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }

    const { code } = (await req.json()) as { code?: string };
    if (!code) {
      return NextResponse.json(
        { error: "Verification code is required" },
        { status: 400 },
      );
    }

    const verification = await verifyOtp(session.user.id, code, "MFA_VERIFY");
    if (!verification.ok) {
      const msg =
        verification.reason === "EXPIRED"
          ? "That code has expired — request a new one."
          : verification.reason === "EXHAUSTED"
            ? "Too many wrong attempts on that code — request a new one."
            : verification.reason === "NONE_ISSUED"
              ? "Request a verification code first."
              : "That code is incorrect.";
      return NextResponse.json({ error: msg }, { status: 401 });
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: true },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_MFA_ENABLED",
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { method: "EMAIL_OTP" },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to enable MFA", error, { route: "/api/auth/mfa/enable" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
