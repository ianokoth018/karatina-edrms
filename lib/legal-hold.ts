import crypto from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { sendMail, buildWorkflowEmail } from "@/lib/mailer";

// ---------------------------------------------------------------------------
// Legal hold sync
//
// `Document.isOnLegalHold` is the canonical "is this preserved?" flag used
// everywhere (delete guards, disposition, retention). This module is the
// single writer when membership in a LegalMatter changes:
//
//   * adding a doc to ANY open matter   →  isOnLegalHold = true
//   * removing a doc from a matter      →  recompute (true iff any other
//                                          open matter still holds it)
//   * closing a matter                  →  recompute every doc it held
//
// Nothing else should toggle the flag based on matter membership. The
// pre-existing manual hold API (/api/documents/[id]/legal-hold) remains a
// separate ad-hoc path and is not driven from here.
// ---------------------------------------------------------------------------

const ACK_SECRET =
  process.env.LEGAL_HOLD_ACK_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  "legal-hold-dev-secret";

const ACK_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year — holds run long.

/** HMAC-sign a payload so the public ack URL can't be forged. */
function signAckToken(custodianId: string, matterId: string, expMs: number): string {
  const payload = `${custodianId}.${matterId}.${expMs}`;
  const sig = crypto
    .createHmac("sha256", ACK_SECRET)
    .update(payload)
    .digest("hex");
  // base64url(payload) + "." + sig — opaque to the URL, verifiable server-side.
  const enc = Buffer.from(payload, "utf8").toString("base64url");
  return `${enc}.${sig}`;
}

export interface VerifiedAckToken {
  custodianId: string;
  matterId: string;
  expMs: number;
}

export function verifyAckToken(token: string): VerifiedAckToken | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const enc = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(enc, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto
    .createHmac("sha256", ACK_SECRET)
    .update(payload)
    .digest("hex");
  if (
    expected.length !== sig.length ||
    !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"))
  ) {
    return null;
  }
  const [custodianId, matterId, expStr] = payload.split(".");
  const expMs = Number(expStr);
  if (!custodianId || !matterId || !Number.isFinite(expMs)) return null;
  if (Date.now() > expMs) return null;
  return { custodianId, matterId, expMs };
}

/**
 * Add documents to a matter. Idempotent — already-attached docs are
 * silently skipped. Sets `document.isOnLegalHold = true` and stamps
 * `legalHoldReason` with the matter name so existing UI shows context.
 * Returns the number of newly attached documents.
 */
export async function addDocumentsToMatter(
  matterId: string,
  documentIds: string[],
  byUserId: string,
): Promise<number> {
  if (documentIds.length === 0) return 0;

  const matter = await db.legalMatter.findUnique({
    where: { id: matterId },
    select: { id: true, name: true, status: true, matterNumber: true },
  });
  if (!matter) throw new Error("Matter not found");
  if (matter.status !== "OPEN") {
    throw new Error("Cannot add documents to a closed matter");
  }

  // Insert join rows; skip duplicates so this stays idempotent.
  const existing = await db.legalMatterDocument.findMany({
    where: { matterId, documentId: { in: documentIds } },
    select: { documentId: true },
  });
  const already = new Set(existing.map((r) => r.documentId));
  const toAdd = documentIds.filter((d) => !already.has(d));

  if (toAdd.length === 0) return 0;

  await db.$transaction([
    db.legalMatterDocument.createMany({
      data: toAdd.map((documentId) => ({ matterId, documentId, addedById: byUserId })),
      skipDuplicates: true,
    }),
    db.document.updateMany({
      where: { id: { in: toAdd } },
      data: {
        isOnLegalHold: true,
        legalHoldReason: `${matter.matterNumber} — ${matter.name}`,
        legalHoldAt: new Date(),
      },
    }),
  ]);

  for (const documentId of toAdd) {
    await writeAudit({
      userId: byUserId,
      action: "legal_hold.document_added",
      resourceType: "Document",
      resourceId: documentId,
      metadata: { matterId, matterNumber: matter.matterNumber },
    });
  }

  return toAdd.length;
}

/**
 * Recompute `isOnLegalHold` for a single document based on whether any OPEN
 * matter still holds it. Pure read-then-update; safe to call repeatedly.
 */
async function recomputeDocumentHold(documentId: string): Promise<void> {
  const stillHeld = await db.legalMatterDocument.findFirst({
    where: { documentId, matter: { status: "OPEN" } },
    select: { matterId: true, matter: { select: { name: true, matterNumber: true } } },
  });
  if (stillHeld) {
    await db.document.update({
      where: { id: documentId },
      data: {
        isOnLegalHold: true,
        legalHoldReason: `${stillHeld.matter.matterNumber} — ${stillHeld.matter.name}`,
      },
    });
  } else {
    await db.document.update({
      where: { id: documentId },
      data: {
        isOnLegalHold: false,
        legalHoldReason: null,
        legalHoldAt: null,
      },
    });
  }
}

/**
 * Remove a document from a matter. If no other OPEN matter still references
 * the doc, clear `isOnLegalHold`.
 */
export async function removeDocumentFromMatter(
  matterId: string,
  documentId: string,
  byUserId: string,
): Promise<void> {
  // Use deleteMany so we don't throw if the row is already gone.
  const result = await db.legalMatterDocument.deleteMany({
    where: { matterId, documentId },
  });
  if (result.count === 0) return;
  await recomputeDocumentHold(documentId);

  await writeAudit({
    userId: byUserId,
    action: "legal_hold.document_removed",
    resourceType: "Document",
    resourceId: documentId,
    metadata: { matterId },
  });
}

/**
 * Close a matter and recompute hold state for every document it referenced.
 * Audits the close itself; per-document recomputes are not separately audited
 * (the matter close + the original add events tell the story).
 */
export async function closeMatter(matterId: string, byUserId: string): Promise<void> {
  const matter = await db.legalMatter.findUnique({
    where: { id: matterId },
    select: { id: true, status: true, matterNumber: true, name: true },
  });
  if (!matter) throw new Error("Matter not found");
  if (matter.status === "CLOSED") return;

  const docs = await db.legalMatterDocument.findMany({
    where: { matterId },
    select: { documentId: true },
  });

  await db.legalMatter.update({
    where: { id: matterId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  for (const { documentId } of docs) {
    await recomputeDocumentHold(documentId);
  }

  await writeAudit({
    userId: byUserId,
    action: "legal_hold.matter_closed",
    resourceType: "LegalMatter",
    resourceId: matterId,
    metadata: {
      matterNumber: matter.matterNumber,
      documentsReleased: docs.length,
    },
  });
}

/**
 * Reopen a closed matter. Re-flags every doc on it as held.
 * (Convenience — not exposed in the spec but small and useful.)
 */
export async function reopenMatter(matterId: string, byUserId: string): Promise<void> {
  const matter = await db.legalMatter.findUnique({
    where: { id: matterId },
    select: { id: true, status: true, matterNumber: true, name: true },
  });
  if (!matter) throw new Error("Matter not found");
  if (matter.status === "OPEN") return;

  await db.legalMatter.update({
    where: { id: matterId },
    data: { status: "OPEN", closedAt: null },
  });

  const docs = await db.legalMatterDocument.findMany({
    where: { matterId },
    select: { documentId: true },
  });
  for (const { documentId } of docs) {
    await recomputeDocumentHold(documentId);
  }

  await writeAudit({
    userId: byUserId,
    action: "legal_hold.matter_reopened",
    resourceType: "LegalMatter",
    resourceId: matterId,
    metadata: { matterNumber: matter.matterNumber, documentsRefrozen: docs.length },
  });
}

/**
 * Resolve a custodian's email/name from the linked user row (if any) or the
 * external fields. Returns null when no email is available.
 */
async function resolveCustodianContact(custodianId: string): Promise<{
  matterId: string;
  email: string | null;
  name: string;
  matterName: string;
  matterNumber: string;
} | null> {
  const c = await db.legalMatterCustodian.findUnique({
    where: { id: custodianId },
    select: {
      matterId: true,
      userId: true,
      externalName: true,
      externalEmail: true,
      matter: { select: { name: true, matterNumber: true } },
    },
  });
  if (!c) return null;

  let email: string | null = c.externalEmail ?? null;
  let name: string = c.externalName ?? "Custodian";
  if (c.userId) {
    const u = await db.user.findUnique({
      where: { id: c.userId },
      select: { email: true, displayName: true, name: true },
    });
    if (u) {
      email = u.email;
      name = u.displayName ?? u.name ?? name;
    }
  }
  return {
    matterId: c.matterId,
    email,
    name,
    matterName: c.matter.name,
    matterNumber: c.matter.matterNumber,
  };
}

/**
 * Send (or re-send) the hold notice for one custodian. Generates a fresh
 * signed ackToken, upserts the LegalHoldNotice row, and sends an email
 * pointing at the public ack URL. Idempotent — safe to call repeatedly.
 *
 * Returns true when an email actually went out, false when SMTP isn't
 * configured or there's no address on file (the notice row is still
 * recorded either way so the audit trail is complete).
 */
export async function sendHoldNotice(
  custodianId: string,
  byUserId: string,
  origin: string,
): Promise<{ sent: boolean; noticeId: string; ackToken: string }> {
  const contact = await resolveCustodianContact(custodianId);
  if (!contact) throw new Error("Custodian not found");

  const expMs = Date.now() + ACK_TOKEN_TTL_MS;
  const ackToken = signAckToken(custodianId, contact.matterId, expMs);

  const notice = await db.legalHoldNotice.upsert({
    where: { custodianId },
    create: {
      custodianId,
      matterId: contact.matterId,
      ackToken,
      sentAt: new Date(),
    },
    update: {
      // Resending replaces the token AND wipes the prior ack so the new
      // notice must be acknowledged on its own merit.
      ackToken,
      sentAt: new Date(),
      acknowledgedAt: null,
    },
  });

  await writeAudit({
    userId: byUserId,
    action: "legal_hold.notice_sent",
    resourceType: "LegalHoldNotice",
    resourceId: notice.id,
    metadata: {
      matterId: contact.matterId,
      custodianId,
      to: contact.email,
    },
  });

  if (!contact.email) {
    logger.warn("Legal hold notice has no email recipient", { custodianId });
    return { sent: false, noticeId: notice.id, ackToken };
  }

  const ackUrl = `${origin.replace(/\/$/, "")}/legal-hold/ack/${encodeURIComponent(ackToken)}`;
  const html = buildWorkflowEmail({
    recipientName: contact.name,
    subject: `Legal Hold Notice — ${contact.matterNumber}`,
    body: `You are identified as a custodian of records relevant to <b>${escapeHtml(contact.matterName)}</b> (${escapeHtml(contact.matterNumber)}). You must preserve all paper and electronic records — including email, drafts, and notes — that relate to this matter. Do not delete, alter, or destroy any such records until you are formally notified that the hold has been released.<br/><br/>Please acknowledge that you have read and understood this notice by clicking the button below.`,
    actionUrl: ackUrl,
    actionLabel: "Acknowledge Legal Hold",
  });

  const sent = await sendMail({
    to: contact.email,
    subject: `Legal Hold Notice — ${contact.matterNumber}`,
    html,
  });

  return { sent, noticeId: notice.id, ackToken };
}

/** Mark a notice acknowledged. Returns true if this call did the marking. */
export async function acknowledgeNotice(
  noticeId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<boolean> {
  const notice = await db.legalHoldNotice.findUnique({
    where: { id: noticeId },
    select: { id: true, custodianId: true, matterId: true, acknowledgedAt: true },
  });
  if (!notice) return false;
  if (notice.acknowledgedAt) {
    // Already acknowledged — still audit the duplicate visit but don't
    // overwrite the timestamp.
    return false;
  }
  await db.legalHoldNotice.update({
    where: { id: noticeId },
    data: { acknowledgedAt: new Date() },
  });
  await writeAudit({
    action: "legal_hold.notice_acknowledged",
    resourceType: "LegalHoldNotice",
    resourceId: notice.id,
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    metadata: {
      matterId: notice.matterId,
      custodianId: notice.custodianId,
    },
  });
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
