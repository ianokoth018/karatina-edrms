import { logger } from "@/lib/logger";

// Lazy-init AfricasTalking to avoid import errors when env vars are absent
let smsService: { send: (opts: { to: string[]; message: string; from?: string }) => Promise<unknown> } | null = null;

function getSmsService() {
  if (smsService) return smsService;
  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  if (!apiKey || !username) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require("africastalking");
  const client = AfricasTalking({ apiKey, username });
  smsService = client.SMS;
  return smsService;
}

export interface SmsOptions {
  to: string | string[];
  message: string;
}

/** Send an SMS. Returns true on success, false if unconfigured or on error. */
export async function sendSms({ to, message }: SmsOptions): Promise<boolean> {
  const svc = getSmsService();
  if (!svc) {
    logger.debug("SMS not configured (AT_API_KEY / AT_USERNAME missing) — skipping");
    return false;
  }

  const recipients = Array.isArray(to) ? to : [to];
  // Africa's Talking requires E.164 format (+254...)
  const normalised = recipients.map((n) => (n.startsWith("+") ? n : `+${n.replace(/^0/, "254")}`));

  try {
    await svc.send({ to: normalised, message, from: process.env.AT_SENDER_ID });
    logger.info("SMS sent", { to: normalised });
    return true;
  } catch (err) {
    logger.error("SMS send failed", err);
    return false;
  }
}

/** Build a task-assignment SMS message. */
export function buildTaskSms({
  recipientName,
  stepName,
  instanceRef,
  subject,
  dueAt,
  appUrl,
}: {
  recipientName: string;
  stepName: string;
  instanceRef: string;
  subject: string;
  dueAt?: Date | null;
  appUrl?: string;
}): string {
  const due = dueAt
    ? ` Due: ${dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`
    : "";
  const link = appUrl ? ` ${appUrl}` : "";
  return `Hi ${recipientName}, you have a new workflow task: "${stepName}" for ${subject} (${instanceRef}).${due}${link}`;
}

/** Build an SLA breach SMS message. */
export function buildSlaSms({
  recipientName,
  stepName,
  instanceRef,
  hoursOverdue,
}: {
  recipientName: string;
  stepName: string;
  instanceRef: string;
  hoursOverdue: number;
}): string {
  return `URGENT: Workflow task "${stepName}" (${instanceRef}) is ${Math.round(hoursOverdue)}h overdue, ${recipientName}. Please action immediately.`;
}

/** Build a workflow-completion SMS. */
export function buildCompletionSms({
  recipientName,
  instanceRef,
  subject,
  outcome,
}: {
  recipientName: string;
  instanceRef: string;
  subject: string;
  outcome: "COMPLETED" | "CANCELLED" | string;
}): string {
  const word = outcome === "COMPLETED" ? "completed" : "ended";
  return `Hi ${recipientName}, workflow ${instanceRef} (${subject}) has ${word}.`;
}
