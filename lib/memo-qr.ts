import QRCode from "qrcode";
import { createMemoShareToken } from "@/lib/memo-share";

/**
 * Build a PNG QR code that, when scanned, opens the public memo
 * verification page for the given memo (workflow instance id).
 *
 * The QR encodes a URL of the form `${baseUrl}/memo/verify/${token}` where
 * `token` is the standard signed share token from lib/memo-share.ts. Use
 * a long TTL (default 365 days) because authentic memos need to remain
 * verifiable for the document's retention period.
 */
export async function generateMemoVerificationQrPng(
  memoId: string,
  opts?: { ttlDays?: number; baseUrl?: string }
): Promise<Uint8Array> {
  const ttlDays = opts?.ttlDays ?? 365;
  const baseUrl =
    opts?.baseUrl ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL ??
    "";
  if (!baseUrl) {
    throw new Error(
      "generateMemoVerificationQrPng: no base URL configured " +
        "(set APP_URL / NEXT_PUBLIC_APP_URL / AUTH_URL)"
    );
  }
  const token = createMemoShareToken(memoId, ttlDays);
  const verifyUrl = `${baseUrl.replace(/\/$/, "")}/memo/verify/${token}`;
  const buf = await QRCode.toBuffer(verifyUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
  return new Uint8Array(buf);
}

/**
 * Returns just the verification URL, e.g. for showing under the QR or
 * for emailing as a fallback.
 */
export function buildMemoVerificationUrl(
  memoId: string,
  opts?: { ttlDays?: number; baseUrl?: string }
): string {
  const ttlDays = opts?.ttlDays ?? 365;
  const baseUrl =
    opts?.baseUrl ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL ??
    "";
  if (!baseUrl) {
    throw new Error("buildMemoVerificationUrl: no base URL configured");
  }
  const token = createMemoShareToken(memoId, ttlDays);
  return `${baseUrl.replace(/\/$/, "")}/memo/verify/${token}`;
}
