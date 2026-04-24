import { Text } from "@react-email/components";
import * as React from "react";
import KaruEmailLayout, { MetadataItem, KARU_GOLD } from "./components/karu-layout";

export interface MemoCirculatedEmailProps {
  recipientName: string;
  /** Display name of the user circulating the memo */
  circulatedByName: string;
  /** Optional designation/role of the circulator */
  circulatedByTitle?: string;
  /** Memo reference (e.g. KARU/ICT/9/56) */
  memoReference: string;
  /** Workflow reference (e.g. WF-2026-000005) */
  workflowReference?: string;
  /** Memo subject line */
  subject: string;
  /** Optional free-text message the circulator added */
  message?: string;
  /** Memo originator display name */
  fromName?: string;
  /** Memo final approver display name (if approved) */
  approvedByName?: string;
  /** Approval date display string */
  approvedAt?: string;
  /** Public view URL (no login required) */
  viewUrl: string;
  /** Public download URL (no login required) */
  downloadUrl: string;
  /** Optional in-system URL (requires login) */
  systemUrl?: string;
}

export default function MemoCirculatedEmail({
  recipientName,
  circulatedByName,
  circulatedByTitle,
  memoReference,
  workflowReference,
  subject,
  message,
  fromName,
  approvedByName,
  approvedAt,
  viewUrl,
  downloadUrl,
  systemUrl,
}: MemoCirculatedEmailProps) {
  const metadata: MetadataItem[] = [
    { label: "Memo Ref", value: memoReference },
    ...(workflowReference ? [{ label: "Workflow", value: workflowReference }] : []),
    { label: "Subject", value: subject },
    ...(fromName ? [{ label: "From", value: fromName }] : []),
    ...(approvedByName
      ? [
          {
            label: "Approved by",
            value: approvedAt ? `${approvedByName} · ${approvedAt}` : approvedByName,
          },
        ]
      : []),
    {
      label: "Circulated by",
      value: circulatedByTitle
        ? `${circulatedByName} (${circulatedByTitle})`
        : circulatedByName,
    },
  ];

  const previewBody = message
    ? `${circulatedByName} circulated "${subject}": ${message}`
    : `${circulatedByName} has circulated the memo "${subject}" to you.`;

  return (
    <KaruEmailLayout
      preview={previewBody.slice(0, 90)}
      heading="A memo has been circulated to you"
      recipientName={recipientName}
      metadata={metadata}
      cta={{ label: "Open memo (no login required)", url: viewUrl }}
      secondaryLink={
        systemUrl ? { label: "Open inside EDRMS (login required)", url: systemUrl } : undefined
      }
    >
      <Text style={{ margin: "0 0 12px 0", lineHeight: "1.7", fontSize: "14px" }}>
        <strong>{circulatedByName}</strong>
        {circulatedByTitle ? ` (${circulatedByTitle})` : ""} has shared the
        following memo with you for your information.
      </Text>

      {message && (
        <Text
          style={{
            margin: "0 0 16px 0",
            padding: "12px 16px",
            borderLeft: "3px solid #02773b",
            backgroundColor: "#f0fdf4",
            fontSize: "14px",
            color: "#1f2937",
            lineHeight: "1.6",
            fontStyle: "italic",
          }}
        >
          “{message}”
        </Text>
      )}

      <Text style={{ margin: "0 0 16px 0", lineHeight: "1.7", fontSize: "14px" }}>
        The full memo PDF is attached to this email. You can also{" "}
        <a href={viewUrl} style={{ color: "#02773b", fontWeight: 600 }}>
          view it online
        </a>
        {" "}or{" "}
        <a href={downloadUrl} style={{ color: KARU_GOLD, fontWeight: 600 }}>
          download a fresh copy
        </a>
        {" "}— no login is required.
      </Text>
    </KaruEmailLayout>
  );
}

MemoCirculatedEmail.PreviewProps = {
  recipientName: "Mr. Joseph Nderitu",
  circulatedByName: "System Administrator",
  circulatedByTitle: "ICT Directorate",
  memoReference: "KARU/ICT/9/56",
  workflowReference: "WF-2026-000005",
  subject: "Notice of Public Holiday Closure",
  message:
    "Please share with your unit ahead of Friday so the front desks can adjust their rosters.",
  fromName: "Dr. Ruth Mugo",
  approvedByName: "Prof. John Mwangi",
  approvedAt: "24 Apr 2026",
  viewUrl: "https://edrms.karu.ac.ke/api/memos/public/abc.def",
  downloadUrl: "https://edrms.karu.ac.ke/api/memos/public/abc.def?download=1",
  systemUrl: "https://edrms.karu.ac.ke/memos/cmocznzht000j4p3o1m3r76xd",
} satisfies MemoCirculatedEmailProps;
