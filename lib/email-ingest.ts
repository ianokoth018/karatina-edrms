/**
 * Email Ingest — rule-driven inbound mail auto-ingest pipeline.
 *
 * Each EmailIngestRule watches one IMAP mailbox and persists matching
 * messages directly as Documents (one per message). Attachments become
 * additional DocumentFiles linked to that Document. Body content (text
 * + HTML) is saved as the primary file.
 *
 * This is intentionally distinct from the CaptureProfile (sourceType=EMAIL)
 * flow which drops PDF attachments into a hot folder for the main capture
 * worker — that flow loses the message body and tags; this one preserves
 * the full message and tags every ingested document.
 */

import type { EmailIngestRule } from "@prisma/client";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateReference } from "@/lib/reference";
import { writeAudit } from "@/lib/audit";
import { decryptSecret, encryptFileStreaming } from "@/lib/encryption";
import {
  scanBuffer,
  shouldRejectIngest,
  describeScanResult,
} from "@/lib/antivirus";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "edrms");

export interface IngestResult {
  processed: number;
  errors: string[];
}

/** Flatten a multipart body-structure tree into a flat list with part numbers. */
function flattenParts(
  node: MessageStructureObject | undefined,
  acc: MessageStructureObject[] = []
): MessageStructureObject[] {
  if (!node) return acc;
  if (node.childNodes && node.childNodes.length > 0) {
    for (const child of node.childNodes) flattenParts(child, acc);
  } else {
    acc.push(node);
  }
  return acc;
}

/** True when the structure node represents an attachment (has a filename). */
function isAttachment(part: MessageStructureObject): boolean {
  const dispoFilename = part.dispositionParameters?.filename;
  const paramName = part.parameters?.name;
  return Boolean(dispoFilename || paramName);
}

function getAttachmentName(part: MessageStructureObject, fallback: string): string {
  const name = part.dispositionParameters?.filename ?? part.parameters?.name ?? fallback;
  // Strip path separators so we don't escape the upload dir.
  return name.replace(/[\\/]/g, "_").slice(0, 240);
}

function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
    eml: "message/rfc822",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Best-effort plaintext extraction from HTML for indexing/OCR-like search. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function persistFile(
  refDir: string,
  fileName: string,
  data: Buffer
): Promise<{ relPath: string; size: number; iv: string | null; tag: string | null }> {
  await fs.mkdir(refDir, { recursive: true });
  const absPath = path.join(refDir, fileName);
  await fs.writeFile(absPath, data);
  const stats = await fs.stat(absPath);

  let iv: string | null = null;
  let tag: string | null = null;
  try {
    const enc = await encryptFileStreaming(absPath);
    iv = enc.iv;
    tag = enc.tag;
  } catch (encErr) {
    logger.warn("email-ingest: encryption skipped", {
      err: encErr instanceof Error ? encErr.message : String(encErr),
    });
  }

  return {
    relPath: path.relative(process.cwd(), absPath).replace(/\\/g, "/"),
    size: stats.size,
    iv,
    tag,
  };
}

interface ProcessedMessage {
  textBody: string;
  htmlBody: string;
  attachments: Array<{ filename: string; mime: string; data: Buffer }>;
}

async function downloadMessageContent(
  client: ImapFlow,
  msg: FetchMessageObject
): Promise<ProcessedMessage> {
  const parts = flattenParts(msg.bodyStructure);
  let textBody = "";
  let htmlBody = "";
  const attachments: ProcessedMessage["attachments"] = [];

  for (const part of parts) {
    const partKey = part.part ?? "1";
    const isAtt = isAttachment(part);
    const lowerType = (part.type || "").toLowerCase();

    if (!isAtt && lowerType === "text/plain" && !textBody) {
      try {
        const dl = await client.download(String(msg.uid), partKey, { uid: true });
        if (dl) {
          const chunks: Buffer[] = [];
          for await (const c of dl.content) chunks.push(c as Buffer);
          textBody = Buffer.concat(chunks).toString(dl.meta.charset === "us-ascii" ? "utf8" : "utf8");
        }
      } catch (err) {
        logger.warn("email-ingest: failed to read text/plain part", { err: String(err) });
      }
      continue;
    }

    if (!isAtt && lowerType === "text/html" && !htmlBody) {
      try {
        const dl = await client.download(String(msg.uid), partKey, { uid: true });
        if (dl) {
          const chunks: Buffer[] = [];
          for await (const c of dl.content) chunks.push(c as Buffer);
          htmlBody = Buffer.concat(chunks).toString("utf8");
        }
      } catch (err) {
        logger.warn("email-ingest: failed to read text/html part", { err: String(err) });
      }
      continue;
    }

    if (isAtt) {
      const fname = getAttachmentName(part, `attachment-${partKey}.bin`);
      try {
        const dl = await client.download(String(msg.uid), partKey, { uid: true });
        if (!dl) continue;
        const chunks: Buffer[] = [];
        for await (const c of dl.content) chunks.push(c as Buffer);
        const data = Buffer.concat(chunks);
        attachments.push({
          filename: fname,
          mime: dl.meta.contentType || guessMimeFromName(fname),
          data,
        });
      } catch (err) {
        logger.warn("email-ingest: failed to download attachment", { fname, err: String(err) });
      }
    }
  }

  return { textBody, htmlBody, attachments };
}

/**
 * Connect to the configured IMAP mailbox and ingest every UNSEEN message
 * that matches the rule's filters. Returns counts. Never throws — IMAP /
 * credential errors are returned via the `errors[]` array.
 */
export async function runEmailIngestRule(
  rule: EmailIngestRule
): Promise<IngestResult> {
  const result: IngestResult = { processed: 0, errors: [] };

  let password: string;
  try {
    password = decryptSecret(rule.imapPasswordCipher);
  } catch (err) {
    const msg = `Failed to decrypt IMAP password: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    return result;
  }

  const client = new ImapFlow({
    host: rule.imapHost,
    port: rule.imapPort,
    secure: rule.imapSecure,
    auth: { user: rule.imapUser, pass: password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    result.errors.push(`Connect failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  try {
    await client.mailboxOpen(rule.mailbox);
  } catch (err) {
    result.errors.push(`Open mailbox '${rule.mailbox}' failed: ${err instanceof Error ? err.message : String(err)}`);
    try { await client.logout(); } catch { /* ignore */ }
    return result;
  }

  const fromFilter = rule.fromFilter?.toLowerCase() ?? null;
  let subjectRe: RegExp | null = null;
  if (rule.subjectFilter) {
    try {
      subjectRe = new RegExp(rule.subjectFilter, "i");
    } catch (err) {
      result.errors.push(`Invalid subjectFilter regex: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const tags = rule.tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const department = rule.targetDepartment?.trim() || "GENERAL";

  try {
    for await (const msg of client.fetch(
      { seen: false },
      { envelope: true, bodyStructure: true, uid: true }
    )) {
      if (!msg.envelope) continue;
      const from = msg.envelope.from?.[0]?.address ?? "";
      const subject = msg.envelope.subject ?? "";

      if (fromFilter && !from.toLowerCase().includes(fromFilter)) continue;
      if (subjectRe && !subjectRe.test(subject)) continue;

      try {
        const { textBody, htmlBody, attachments } = await downloadMessageContent(client, msg);

        // Antivirus scan the message body + every attachment before anything
        // hits disk. Any hit causes the whole message to be skipped (and
        // flagged Seen) so we don't re-process it.
        const scanTargets: Array<{ name: string; buf: Buffer }> = [
          { name: htmlBody ? "message.html" : "message.txt", buf: Buffer.from(htmlBody || textBody || "(empty)", "utf8") },
          ...attachments.map((a) => ({ name: a.filename, buf: a.data })),
        ];
        let infected: { name: string; result: ReturnType<typeof describeScanResult> } | null = null;
        for (const t of scanTargets) {
          const r = await scanBuffer(t.buf);
          if (shouldRejectIngest(r)) {
            infected = { name: t.name, result: describeScanResult(r) };
            break;
          }
        }
        if (infected) {
          await writeAudit({
            userId: rule.createdById,
            action: "email.virus_blocked",
            resourceType: "EmailIngestRule",
            resourceId: rule.id,
            metadata: {
              from,
              subject,
              messageId: msg.envelope.messageId ?? null,
              part: infected.name,
              scan: infected.result,
            },
          }).catch(() => null);
          try {
            await client.messageFlagsAdd(String(msg.uid), ["\\Seen"], { uid: true });
          } catch { /* ignore */ }
          result.errors.push(`Blocked '${subject || infected.name}': ${infected.result}`);
          continue;
        }

        const referenceNumber = await generateReference("EML", department);
        const refDir = path.join(UPLOADS_DIR, referenceNumber);

        // Primary file — HTML if available, else plaintext.
        const primaryName = htmlBody ? "message.html" : "message.txt";
        const primaryMime = htmlBody ? "text/html" : "text/plain";
        const primaryBuf = Buffer.from(htmlBody || textBody || "(empty)", "utf8");
        const primary = await persistFile(refDir, primaryName, primaryBuf);

        const indexableText = textBody?.trim().length
          ? textBody
          : htmlBody
            ? htmlToText(htmlBody)
            : "";

        const contentHash = crypto.createHash("sha256").update(primaryBuf).digest("hex");

        const document = await db.document.create({
          data: {
            referenceNumber,
            title: subject || `(no subject) — ${from || "unknown sender"}`,
            description: `Auto-ingested email from ${from || "unknown"}`,
            documentType: rule.targetDocumentType,
            status: "ACTIVE",
            department,
            createdById: rule.createdById,
            sourceSystem: "EMAIL",
            sourceId: msg.envelope.messageId ?? null,
            contentHash,
            metadata: {
              ingestRuleId: rule.id,
              ingestRuleName: rule.name,
              from,
              to:
                msg.envelope.to
                  ?.map((a) => a.address)
                  .filter((a): a is string => typeof a === "string" && a.length > 0) ?? [],
              cc:
                msg.envelope.cc
                  ?.map((a) => a.address)
                  .filter((a): a is string => typeof a === "string" && a.length > 0) ?? [],
              subject,
              messageId: msg.envelope.messageId ?? null,
              receivedAt: msg.envelope.date?.toISOString() ?? null,
              attachmentCount: attachments.length,
            },
            files: {
              create: {
                storagePath: primary.relPath,
                fileName: primaryName,
                mimeType: primaryMime,
                sizeBytes: BigInt(primary.size),
                ocrText: indexableText || null,
                ocrStatus: indexableText ? "COMPLETE" : "PENDING",
                encryptionIv: primary.iv,
                encryptionTag: primary.tag,
              },
            },
            tags: tags.length
              ? { create: tags.map((tag) => ({ tag })) }
              : undefined,
          },
        });

        // Attachments as additional DocumentFile rows.
        for (const att of attachments) {
          const stored = await persistFile(refDir, att.filename, att.data);
          await db.documentFile.create({
            data: {
              documentId: document.id,
              storagePath: stored.relPath,
              fileName: att.filename,
              mimeType: att.mime,
              sizeBytes: BigInt(stored.size),
              ocrStatus: "PENDING",
              encryptionIv: stored.iv,
              encryptionTag: stored.tag,
            },
          });
        }

        // Mark message Seen so we don't re-process it.
        try {
          await client.messageFlagsAdd(String(msg.uid), ["\\Seen"], { uid: true });
        } catch (flagErr) {
          logger.warn("email-ingest: failed to flag message Seen", { err: String(flagErr) });
        }

        // Best-effort CaptureLog (treat the ingest rule id as the profile id
        // is not safe — schema requires a real CaptureProfile FK — so skip).
        // We rely on the audit log + Document.metadata for traceability.
        await writeAudit({
          userId: rule.createdById,
          action: "EMAIL_INGESTED",
          resourceType: "Document",
          resourceId: document.id,
          metadata: {
            ingestRuleId: rule.id,
            from,
            subject,
            attachmentCount: attachments.length,
            referenceNumber,
          },
        });

        result.processed += 1;
      } catch (err) {
        const msgStr = err instanceof Error ? err.message : String(err);
        result.errors.push(`message ${msg.uid}: ${msgStr}`);
        logger.error("email-ingest: failed to ingest message", err, {
          ruleId: rule.id,
          uid: msg.uid,
        });
      }
    }
  } catch (err) {
    result.errors.push(`Fetch loop failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { await client.mailboxClose(); } catch { /* ignore */ }
    try { await client.logout(); } catch { /* ignore */ }
  }

  return result;
}

/**
 * Test an IMAP connection without ingesting. Used by the admin
 * test-connection button. Returns `{ ok: true, mailboxExists: number }`
 * on success, `{ ok: false, error: string }` on failure.
 */
export async function testEmailIngestRule(
  rule: Pick<
    EmailIngestRule,
    "imapHost" | "imapPort" | "imapSecure" | "imapUser" | "imapPasswordCipher" | "mailbox"
  >
): Promise<{ ok: true; mailboxExists: number } | { ok: false; error: string }> {
  let password: string;
  try {
    password = decryptSecret(rule.imapPasswordCipher);
  } catch (err) {
    return { ok: false, error: `Decrypt password failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const client = new ImapFlow({
    host: rule.imapHost,
    port: rule.imapPort,
    secure: rule.imapSecure,
    auth: { user: rule.imapUser, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.mailboxOpen(rule.mailbox);
    const exists = typeof lock.exists === "number" ? lock.exists : 0;
    try { await client.mailboxClose(); } catch { /* ignore */ }
    return { ok: true, mailboxExists: exists };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}
