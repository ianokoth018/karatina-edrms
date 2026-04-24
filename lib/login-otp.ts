import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Email-based login OTP helpers.
 *
 * Codes are 6 digits, single-use, expire in 10 minutes, and capped at
 * 5 verification attempts per code. Old/used/expired codes for the user
 * are invalidated when a new one is issued.
 */

export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;

export type OtpPurpose = "LOGIN" | "MFA_VERIFY";

export function generateOtpCode(): string {
  // Cryptographically random 6-digit code, zero-padded.
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0) % 10 ** OTP_LENGTH;
  return n.toString().padStart(OTP_LENGTH, "0");
}

/**
 * Issue a fresh OTP for a user. Invalidates any existing unused codes
 * for the same user + purpose. Returns the plaintext code (for emailing)
 * and the row id.
 */
export async function issueOtp(
  userId: string,
  purpose: OtpPurpose = "LOGIN",
): Promise<{ code: string; expiresAt: Date }> {
  // Burn any prior outstanding codes — only one valid OTP per user/purpose.
  await db.loginOtp
    .updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    })
    .catch(() => null);

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await db.loginOtp.create({
    data: { userId, codeHash, expiresAt, purpose },
  });
  return { code, expiresAt };
}

export interface VerifyResult {
  ok: boolean;
  reason?: "EXPIRED" | "MISMATCH" | "EXHAUSTED" | "NONE_ISSUED";
}

/**
 * Verify a user-supplied OTP. On success the row is marked used. On
 * failure the attempts counter is incremented and the code is burned
 * once it crosses OTP_MAX_ATTEMPTS.
 */
export async function verifyOtp(
  userId: string,
  attempt: string,
  purpose: OtpPurpose = "LOGIN",
): Promise<VerifyResult> {
  const cleaned = attempt.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: "MISMATCH" };

  const otp = await db.loginOtp.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, reason: "NONE_ISSUED" };
  if (otp.expiresAt.getTime() < Date.now()) {
    await db.loginOtp
      .update({ where: { id: otp.id }, data: { usedAt: new Date() } })
      .catch(() => null);
    return { ok: false, reason: "EXPIRED" };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "EXHAUSTED" };
  }

  const matches = await bcrypt.compare(cleaned, otp.codeHash);
  if (!matches) {
    const newAttempts = otp.attempts + 1;
    await db.loginOtp.update({
      where: { id: otp.id },
      data: {
        attempts: newAttempts,
        // Burn the code if attempts maxed out so an attacker can't keep guessing
        usedAt: newAttempts >= OTP_MAX_ATTEMPTS ? new Date() : null,
      },
    });
    return { ok: false, reason: "MISMATCH" };
  }

  await db.loginOtp.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });
  return { ok: true };
}
