import { Text } from "@react-email/components";
import * as React from "react";
import KaruEmailLayout, { MetadataItem } from "./components/karu-layout";

export interface WorkflowNotificationProps {
  /** Recipient name; pass "Recipient" for external addresses */
  recipientName: string;
  /** Email subject (also used as the in-body heading) */
  subject: string;
  /** Body text or HTML — pass plain text or simple HTML */
  body: string;
  /** Whether `body` already contains HTML (default: true) */
  bodyIsHtml?: boolean;
  /** Optional metadata facts shown above the CTA */
  metadata?: MetadataItem[];
  /** Optional CTA button */
  cta?: { label: string; url: string };
}

export default function WorkflowNotification({
  recipientName,
  subject,
  body,
  bodyIsHtml = true,
  metadata,
  cta,
}: WorkflowNotificationProps) {
  const previewBody = body
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  return (
    <KaruEmailLayout
      preview={previewBody || subject}
      heading={subject}
      recipientName={recipientName}
      metadata={metadata}
      cta={cta}
    >
      {bodyIsHtml ? (
        <div
          style={{
            fontSize: "14px",
            lineHeight: "1.7",
            color: "#1f2937",
          }}
          // body originates from workflow node config — already HTML
          dangerouslySetInnerHTML={{ __html: body }}
        />
      ) : (
        body.split(/\n\n+/).map((para, idx) => (
          <Text
            key={idx}
            style={{
              margin: idx === 0 ? "0 0 12px 0" : "12px 0",
              fontSize: "14px",
              lineHeight: "1.7",
            }}
          >
            {para}
          </Text>
        ))
      )}
    </KaruEmailLayout>
  );
}

WorkflowNotification.PreviewProps = {
  recipientName: "Prof. John Mwangi",
  subject: "Memo approved",
  body: "Your memo <strong>Notice of Public Holiday Closure</strong> has been approved by the Vice Chancellor. The signed copy is now available in the EDRMS.",
  metadata: [
    { label: "Memo Ref", value: "KARU/ICT/9/56" },
    { label: "Approved by", value: "Prof. John Mwangi" },
  ],
  cta: {
    label: "View memo",
    url: "https://edrms.karu.ac.ke/memos/cmocznzht000j4p3o1m3r76xd",
  },
} satisfies WorkflowNotificationProps;
