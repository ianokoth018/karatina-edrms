import { Text } from "@react-email/components";
import * as React from "react";
import KaruEmailLayout from "./components/karu-layout";

export interface LoginOtpEmailProps {
  recipientName: string;
  /** The plaintext 6-digit code */
  otp: string;
  /** Minutes until expiry */
  validityMinutes: number;
  /** "Sign-in" or "Enable Two-Factor" — adjusts the heading tone */
  purpose?: "LOGIN" | "MFA_VERIFY";
  /** IP address requesting the code (shown so user can spot fraud) */
  requestIp?: string;
}

export default function LoginOtpEmail({
  recipientName,
  otp,
  validityMinutes,
  purpose = "LOGIN",
  requestIp,
}: LoginOtpEmailProps) {
  const heading =
    purpose === "MFA_VERIFY"
      ? "Confirm Two-Factor Authentication"
      : "Your sign-in code";
  const description =
    purpose === "MFA_VERIFY"
      ? "Use this code to confirm that email Two-Factor Authentication works for your account."
      : "We received a sign-in attempt for your EDRMS account. Use the code below to finish signing in.";

  return (
    <KaruEmailLayout
      preview={`Your EDRMS sign-in code is ${otp}`}
      heading={heading}
      recipientName={recipientName}
      disclaimer="If you didn't request this code, ignore this email and consider changing your password. The Karatina University EDRMS will never ask you to share this code with anyone."
    >
      <Text style={{ margin: "0 0 12px 0", fontSize: "14px", lineHeight: "1.7" }}>
        {description}
      </Text>

      {/* OTP block */}
      <div
        style={{
          margin: "20px 0 12px 0",
          padding: "20px",
          textAlign: "center" as const,
          backgroundColor: "#f9fafb",
          border: "1px dashed #02773b",
          borderRadius: "10px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "1.4px",
            marginBottom: "10px",
          }}
        >
          {purpose === "MFA_VERIFY" ? "Verification code" : "Sign-in code"}
        </div>
        <div
          style={{
            fontSize: "32px",
            fontWeight: 700,
            letterSpacing: "10px",
            color: "#02773b",
            fontFamily: "Menlo, Consolas, monospace",
          }}
        >
          {otp}
        </div>
      </div>

      <Text
        style={{
          margin: "0",
          fontSize: "12px",
          lineHeight: "1.6",
          color: "#6b7280",
        }}
      >
        This code is valid for {validityMinutes} minutes
        {requestIp ? ` and was requested from IP ${requestIp}` : ""}. It can
        only be used once.
      </Text>
    </KaruEmailLayout>
  );
}

LoginOtpEmail.PreviewProps = {
  recipientName: "Dr. Ruth Mugo",
  otp: "428561",
  validityMinutes: 10,
  purpose: "LOGIN" as const,
  requestIp: "192.168.10.42",
} satisfies LoginOtpEmailProps;
