import { Text } from "@react-email/components";
import * as React from "react";
import KaruEmailLayout, { MetadataItem } from "./components/karu-layout";

export interface WorkflowActionRequiredProps {
  recipientName: string;
  /** Step name the recipient must action, e.g. "HOD Endorsement" */
  stepLabel: string;
  /** Workflow subject line, e.g. "Notice of Public Holiday Closure" */
  workflowSubject: string;
  /** Workflow reference, e.g. "WF-2026-000005" */
  workflowReference?: string;
  /** Document reference, e.g. "KARU/ICT/9/56" */
  documentReference?: string;
  /** ISO date string for the task due date */
  dueAt?: string;
  /** Initiator display name (who sent it) */
  initiatorName?: string;
  /** Direct URL to the task */
  actionUrl: string;
}

function formatDueDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return undefined;
  }
}

export default function WorkflowActionRequired({
  recipientName,
  stepLabel,
  workflowSubject,
  workflowReference,
  documentReference,
  dueAt,
  initiatorName,
  actionUrl,
}: WorkflowActionRequiredProps) {
  const metadata: MetadataItem[] = [];
  if (documentReference) metadata.push({ label: "Reference", value: documentReference });
  if (workflowReference)
    metadata.push({ label: "Workflow", value: workflowReference });
  if (initiatorName) metadata.push({ label: "Initiated by", value: initiatorName });
  metadata.push({ label: "Step", value: stepLabel });
  const due = formatDueDate(dueAt);
  if (due) metadata.push({ label: "Due", value: due });

  return (
    <KaruEmailLayout
      preview={`Action required: ${stepLabel} — ${workflowSubject}`}
      heading="Action required"
      recipientName={recipientName}
      metadata={metadata}
      cta={{ label: "Open task", url: actionUrl }}
    >
      <Text style={{ margin: "0 0 12px 0", lineHeight: "1.7", fontSize: "14px" }}>
        You have been assigned the step <strong>{stepLabel}</strong> for the
        following item:
      </Text>
      <Text
        style={{
          margin: "0 0 12px 0",
          padding: "10px 14px",
          borderLeft: "3px solid #02773b",
          backgroundColor: "#f0fdf4",
          fontSize: "14px",
          fontWeight: 600,
          color: "#1f2937",
          lineHeight: "1.5",
        }}
      >
        {workflowSubject}
      </Text>
      <Text style={{ margin: "0", lineHeight: "1.7", fontSize: "14px" }}>
        Please review the details below and complete your action so the
        workflow can move on to the next step.
      </Text>
    </KaruEmailLayout>
  );
}

WorkflowActionRequired.PreviewProps = {
  recipientName: "Dr. Ruth Mugo",
  stepLabel: "HOD Endorsement",
  workflowSubject: "Notice of Public Holiday Closure",
  workflowReference: "WF-2026-000005",
  documentReference: "KARU/ICT/9/56",
  initiatorName: "System Administrator",
  dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  actionUrl: "https://edrms.karu.ac.ke/workflows",
} satisfies WorkflowActionRequiredProps;
