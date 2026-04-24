import { Text } from "@react-email/components";
import * as React from "react";
import KaruEmailLayout, { MetadataItem } from "./components/karu-layout";

export interface PasswordResetOtpEmailProps {
  recipientName: string;
  /** The plaintext OTP / temporary password */
  otp: string;
  /** Display name of the admin who triggered the reset */
  initiatedByName: string;
  /** Hours of validity for the OTP */
  validityHours: number;
  /** URL to the login page */
  loginUrl: string;
  /** Optional admin note */
  note?: string;
}

export default function PasswordResetOtpEmail({
  recipientName,
  otp,
  initiatedByName,
  validityHours,
  loginUrl,
  note,
}: PasswordResetOtpEmailProps) {
  const metadata: MetadataItem[] = [
    { label: "Reset by", value: initiatedByName },
    {
      label: "Valid for",
      value: validityHours === 1 ? "1 hour" : `${validityHours} hours`,
    },
  ];

  return (
    <KaruEmailLayout
      preview={`Your one-time password to reset your EDRMS password: ${otp}`}
      heading="Your password has been reset"
      recipientName={recipientName}
      metadata={metadata}
      cta={{ label: "Sign in to EDRMS", url: loginUrl }}
      disclaimer="If you did not expect this reset, do not share the code with anyone and contact your records office immediately. The Karatina University EDRMS will never ask you for your password by phone or email."
    >
      <Text style={{ margin: "0 0 12px 0", fontSize: "14px", lineHeight: "1.7" }}>
        An administrator (<strong>{initiatedByName}</strong>) has reset your
        EDRMS password. Use the one-time password below to sign in. You will
        be prompted to set a new permanent password immediately after.
      </Text>

      {note && (
        <Text
          style={{
            margin: "0 0 16px 0",
            padding: "10px 14px",
            borderLeft: "3px solid #02773b",
            backgroundColor: "#f0fdf4",
            fontSize: "13px",
            color: "#1f2937",
            lineHeight: "1.6",
            fontStyle: "italic",
          }}
        >
          “{note}”
        </Text>
      )}

      {/* OTP block */}
      <div
        style={{
          margin: "20px 0 8px 0",
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
          One-time password
        </div>
        <div
          style={{
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "8px",
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
        Use this exactly once. After logging in, the EDRMS will require you to
        set a new password before you can access any other page.
      </Text>
    </KaruEmailLayout>
  );
}

PasswordResetOtpEmail.PreviewProps = {
  recipientName: "Dr. Ruth Mugo",
  otp: "K7-9F2A",
  initiatedByName: "System Administrator",
  validityHours: 24,
  loginUrl: "https://edrms.karu.ac.ke/login",
  note: "Resetting after the SSO migration — please change to a strong personal password on first login.",
} satisfies PasswordResetOtpEmailProps;
