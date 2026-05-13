// ---------------------------------------------------------------------------
// Retention-disposition library.
//
// Discovers documents whose retentionExpiresAt has fallen due, groups them
// into DispositionCertificate drafts, and (after approval) carries out the
// action declared on each document's RetentionSchedule.
//
// Safety rules enforced here:
//   - Legal hold blocks every destructive op (skip + audit).
//   - Active DocumentExternalLock rows block every destructive op.
//   - REVIEW action never auto-disposes — the certificate is parked in a
//     "NEEDS_REVIEW" status for a human to triage.
//   - Document file bytes are NEVER physically deleted; we only flip the
//     Document.status. Forensic recovery stays possible.
// ---------------------------------------------------------------------------
import type { DisposalAction, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { isDocumentLockedForMutation } from "@/lib/document-locks";
import { logger } from "@/lib/logger";

export interface DueDocument {
  documentId: string;
  referenceNumber: string;
  title: string;
  department: string;
  retentionExpiresAt: Date;
  classificationNodeId: string;
  classificationCode: string;
  retentionScheduleId: string;
  action: DisposalAction;
}

/**
 * Return every document whose retention has fallen due and that may legally
 * be considered for disposition right now. Skips DISPOSED docs and anything
 * currently on legal hold. External locks are checked in executeDisposition,
 * because lock state can flip between proposal and execution.
 */
export async function findDueForDisposition(
  now: Date = new Date(),
): Promise<DueDocument[]> {
  const docs = await db.document.findMany({
    where: {
      retentionExpiresAt: { lte: now, not: null },
      status: { notIn: ["DISPOSED"] },
      isOnLegalHold: false,
    },
    select: {
      id: true,
      referenceNumber: true,
      title: true,
      department: true,
      retentionExpiresAt: true,
      classificationNodeId: true,
      classificationNode: {
        select: {
          id: true,
          code: true,
          retentionSchedules: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              id: true,
              disposalAction: true,
            },
          },
        },
      },
    },
  });

  const out: DueDocument[] = [];
  for (const d of docs) {
    const schedule = d.classificationNode?.retentionSchedules?.[0];
    if (!d.classificationNode || !schedule || !d.classificationNodeId) continue;
    if (!d.retentionExpiresAt) continue;
    out.push({
      documentId: d.id,
      referenceNumber: d.referenceNumber,
      title: d.title,
      department: d.department,
      retentionExpiresAt: d.retentionExpiresAt,
      classificationNodeId: d.classificationNodeId,
      classificationCode: d.classificationNode.code,
      retentionScheduleId: schedule.id,
      action: schedule.disposalAction,
    });
  }
  return out;
}

/**
 * Allocate the next `DC-{year}-NNNN` certificate number inside the given
 * transaction. The leading 4-digit pad keeps lexicographic sort stable up
 * to 9999 certificates per year, which is plenty.
 */
async function nextCertificateNumber(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const year = now.getFullYear();
  const prefix = `DC-${year}-`;
  const last = await tx.dispositionCertificate.findFirst({
    where: { certificateNo: { startsWith: prefix } },
    orderBy: { certificateNo: "desc" },
    select: { certificateNo: true },
  });
  let seq = 1;
  if (last) {
    const parts = last.certificateNo.split("-");
    const lastSeq = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (Number.isFinite(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

const ACTION_TO_DISPOSAL_METHOD: Record<DisposalAction, string> = {
  DESTROY: "DIGITAL_DELETION",
  ARCHIVE_PERMANENT: "DIGITAL_DELETION",
  REVIEW: "DIGITAL_DELETION",
};

/**
 * Create a single DRAFT DispositionCertificate that batches the given
 * documents under one approver. The action mix is not constrained here —
 * the caller (worker) is expected to group by RetentionSchedule.disposalAction
 * so every cert holds a homogeneous bundle.
 */
export async function proposeDispositionCertificate(
  documentIds: string[],
  approverId: string,
  opts?: { action?: DisposalAction; remarks?: string },
) {
  if (documentIds.length === 0) {
    throw new Error("proposeDispositionCertificate: documentIds is empty");
  }
  const action = opts?.action ?? null;
  const now = new Date();

  return db.$transaction(async (tx) => {
    const certificateNo = await nextCertificateNumber(tx, now);
    const created = await tx.dispositionCertificate.create({
      data: {
        certificateNo,
        // Disposal date is provisional — finalised at execution time.
        disposalDate: now,
        disposalMethod: action
          ? ACTION_TO_DISPOSAL_METHOD[action]
          : "DIGITAL_DELETION",
        approvedById: approverId,
        documentIds: documentIds,
        documentCount: documentIds.length,
        remarks: opts?.remarks ?? null,
        status: "DRAFT",
      },
    });
    await writeAudit({
      userId: approverId,
      action: "disposition.certificate.proposed",
      resourceType: "DispositionCertificate",
      resourceId: created.id,
      metadata: {
        certificateNo,
        documentCount: documentIds.length,
        action: action ?? null,
        origin: "auto-retention-worker",
      },
    });
    return created;
  });
}

export interface ExecuteResult {
  disposed: number;
  archived: number;
  skipped: { documentId: string; reason: string }[];
  needsReview: boolean;
}

/**
 * Execute an APPROVED disposition certificate.
 *
 *   - Per document, re-check legal hold + external locks. Locked docs are
 *     recorded in `skipped` and audited; the rest are processed.
 *   - REVIEW docs are never auto-disposed. If the cert contains any REVIEW
 *     docs the cert finishes in status "NEEDS_REVIEW" instead of "EXECUTED".
 *   - DESTROY  → Document.status = DISPOSED (file bytes are left intact for
 *                forensic recovery; the auditor's nightmare is a missing file).
 *   - ARCHIVE_PERMANENT → Document.status = ARCHIVED.
 *
 * Whole transaction so a partial failure rolls back document state with the
 * certificate. Audit log writes happen outside the transaction (writeAudit
 * runs its own transaction) so they survive even on rollback paths.
 */
export async function executeDisposition(
  certificateId: string,
  executorId: string,
): Promise<ExecuteResult> {
  const cert = await db.dispositionCertificate.findUnique({
    where: { id: certificateId },
  });
  if (!cert) throw new Error("Certificate not found");
  if (cert.status !== "APPROVED") {
    throw new Error(
      `Certificate must be APPROVED to execute (current: ${cert.status})`,
    );
  }

  const docIds = Array.isArray(cert.documentIds)
    ? (cert.documentIds as string[])
    : [];
  if (docIds.length === 0) {
    throw new Error("Certificate has no documents to dispose");
  }

  // Re-load each document together with its retention schedule to know what
  // action to take. We don't trust state captured at proposal time — legal
  // holds and external locks can be added/removed in between.
  const docs = await db.document.findMany({
    where: { id: { in: docIds } },
    select: {
      id: true,
      referenceNumber: true,
      status: true,
      isOnLegalHold: true,
      classificationNode: {
        select: {
          retentionSchedules: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { disposalAction: true },
          },
        },
      },
    },
  });

  const skipped: ExecuteResult["skipped"] = [];
  const toDispose: { id: string; ref: string; prevStatus: string }[] = [];
  const toArchive: { id: string; ref: string; prevStatus: string }[] = [];
  let needsReview = false;

  for (const id of docIds) {
    const d = docs.find((x) => x.id === id);
    if (!d) {
      skipped.push({ documentId: id, reason: "NOT_FOUND" });
      continue;
    }
    if (d.status === "DISPOSED") {
      skipped.push({ documentId: id, reason: "ALREADY_DISPOSED" });
      continue;
    }
    const lock = await isDocumentLockedForMutation(id);
    if (lock.legalHold) {
      skipped.push({ documentId: id, reason: "LEGAL_HOLD" });
      continue;
    }
    if (lock.locked) {
      skipped.push({ documentId: id, reason: "EXTERNAL_LOCK" });
      continue;
    }

    const action = d.classificationNode?.retentionSchedules?.[0]?.disposalAction;
    if (!action) {
      skipped.push({ documentId: id, reason: "NO_RETENTION_SCHEDULE" });
      continue;
    }

    if (action === "REVIEW") {
      needsReview = true;
      skipped.push({ documentId: id, reason: "REVIEW_REQUIRED" });
      continue;
    }
    if (action === "DESTROY") {
      toDispose.push({ id, ref: d.referenceNumber, prevStatus: d.status });
    } else if (action === "ARCHIVE_PERMANENT") {
      toArchive.push({ id, ref: d.referenceNumber, prevStatus: d.status });
    }
  }

  const executedAt = new Date();
  // If every doc needs review and nothing else, park the cert at
  // NEEDS_REVIEW and skip the EXECUTED transition entirely.
  const allReviewOnly =
    needsReview && toDispose.length === 0 && toArchive.length === 0;

  await db.$transaction(async (tx) => {
    if (toDispose.length > 0) {
      await tx.document.updateMany({
        where: { id: { in: toDispose.map((d) => d.id) } },
        // Bytes intentionally retained — only the status moves to DISPOSED.
        data: { status: "DISPOSED" },
      });
    }
    if (toArchive.length > 0) {
      await tx.document.updateMany({
        where: { id: { in: toArchive.map((d) => d.id) } },
        data: { status: "ARCHIVED" },
      });
    }
    await tx.dispositionCertificate.update({
      where: { id: certificateId },
      data: {
        status: allReviewOnly ? "NEEDS_REVIEW" : "EXECUTED",
        executedAt: allReviewOnly ? null : executedAt,
        disposalDate: executedAt,
      },
    });
  });

  // Audit each per-document outcome. Each writeAudit call runs its own
  // transaction so they don't pile up on the connection above.
  for (const d of toDispose) {
    await writeAudit({
      userId: executorId,
      action: "DOCUMENT_DESTROYED",
      resourceType: "Document",
      resourceId: d.id,
      metadata: {
        certificateId,
        certificateNo: cert.certificateNo,
        referenceNumber: d.ref,
        previousStatus: d.prevStatus,
        newStatus: "DISPOSED",
        bytesRetainedForForensics: true,
      },
    });
  }
  for (const d of toArchive) {
    await writeAudit({
      userId: executorId,
      action: "DOCUMENT_ARCHIVED",
      resourceType: "Document",
      resourceId: d.id,
      metadata: {
        certificateId,
        certificateNo: cert.certificateNo,
        referenceNumber: d.ref,
        previousStatus: d.prevStatus,
        newStatus: "ARCHIVED",
      },
    });
  }
  for (const s of skipped) {
    await writeAudit({
      userId: executorId,
      action: "disposition.skipped",
      resourceType: "Document",
      resourceId: s.documentId,
      metadata: {
        certificateId,
        certificateNo: cert.certificateNo,
        reason: s.reason,
      },
    });
  }
  await writeAudit({
    userId: executorId,
    action: allReviewOnly
      ? "disposition.certificate.needs_review"
      : "disposition.certificate.executed",
    resourceType: "DispositionCertificate",
    resourceId: certificateId,
    metadata: {
      certificateNo: cert.certificateNo,
      disposed: toDispose.length,
      archived: toArchive.length,
      skipped: skipped.length,
      needsReview,
    },
  });

  logger.info("retention-disposition: executed", {
    certificateId,
    certificateNo: cert.certificateNo,
    disposed: toDispose.length,
    archived: toArchive.length,
    skipped: skipped.length,
    needsReview,
  });

  return {
    disposed: toDispose.length,
    archived: toArchive.length,
    skipped,
    needsReview,
  };
}

/**
 * Resolve every user that holds the `records:dispose` permission. Used by
 * the worker to notify records officers when new drafts are created.
 */
export async function findRecordsOfficers(): Promise<
  { id: string; email: string; displayName: string }[]
> {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      roles: {
        some: {
          role: {
            permissions: {
              some: {
                OR: [
                  { resource: "records", action: "dispose" },
                  { resource: "records", action: "manage" },
                  { resource: "admin", action: "manage" },
                ],
              },
            },
          },
        },
      },
    },
    select: { id: true, email: true, displayName: true },
  });
  // Dedupe — a user with multiple matching roles only appears once.
  const seen = new Set<string>();
  const out: { id: string; email: string; displayName: string }[] = [];
  for (const u of users) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}
