import { db } from "@/lib/db";

export interface LockReason {
  source: string;
  type: string;
  ref: string;
}

export interface MutationLockState {
  locked: boolean;
  reasons: LockReason[];
  legalHold: boolean;
}

/**
 * Returns the lock state for a document. A document is locked against
 * destructive mutations (delete, file replace, version delete) when:
 *   - it is on legal hold, OR
 *   - it has at least one active `DocumentExternalLock` (releasedAt is null).
 *
 * Additive operations (uploading a NEW version, adding comments, signing)
 * remain allowed even when locked — only operations that erase or replace
 * the historical record are blocked.
 */
export async function isDocumentLockedForMutation(
  documentId: string
): Promise<MutationLockState> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      isOnLegalHold: true,
      externalLocks: {
        where: { releasedAt: null },
        select: { sourceSystem: true, sourceType: true, sourceRef: true },
      },
    },
  });
  if (!doc) return { locked: false, reasons: [], legalHold: false };

  const reasons: LockReason[] = doc.externalLocks.map((l) => ({
    source: l.sourceSystem,
    type: l.sourceType,
    ref: l.sourceRef,
  }));
  return {
    locked: doc.isOnLegalHold || reasons.length > 0,
    reasons,
    legalHold: doc.isOnLegalHold,
  };
}

export async function acquireExternalLock(input: {
  documentId: string;
  sourceSystem: string;
  sourceType: string;
  sourceRef: string;
  lockedById?: string | null;
  reason?: string | null;
}) {
  // Idempotent on (documentId, sourceSystem, sourceRef) — re-asserting an
  // existing active lock is a no-op so external systems can safely retry.
  const existing = await db.documentExternalLock.findUnique({
    where: {
      documentId_sourceSystem_sourceRef: {
        documentId: input.documentId,
        sourceSystem: input.sourceSystem,
        sourceRef: input.sourceRef,
      },
    },
  });
  if (existing) {
    if (existing.releasedAt) {
      // Resurrect a released lock by clearing release fields.
      return db.documentExternalLock.update({
        where: { id: existing.id },
        data: {
          releasedAt: null,
          releasedById: null,
          lockedAt: new Date(),
          lockedById: input.lockedById ?? null,
          reason: input.reason ?? null,
          sourceType: input.sourceType,
        },
      });
    }
    return existing;
  }
  return db.documentExternalLock.create({
    data: {
      documentId: input.documentId,
      sourceSystem: input.sourceSystem,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      lockedById: input.lockedById ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function releaseExternalLock(input: {
  lockId: string;
  releasedById: string;
}) {
  return db.documentExternalLock.update({
    where: { id: input.lockId },
    data: {
      releasedAt: new Date(),
      releasedById: input.releasedById,
    },
  });
}

/**
 * Standard 409 body shape that destructive routes return when a document
 * is locked. Kept here so all callers stay consistent.
 */
export function lockedResponseBody(state: MutationLockState) {
  return {
    error: "LOCKED",
    message: state.legalHold
      ? "This document is on legal hold and cannot be modified."
      : "This document is locked by an external system reference and cannot be modified.",
    legalHold: state.legalHold,
    reasons: state.reasons,
  };
}
