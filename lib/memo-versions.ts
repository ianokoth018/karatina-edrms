/**
 * Memo versioning — every change that materially affects what a memo
 * looks like or who's signed it produces a new immutable PDF snapshot
 * stored under uploads/memo-versions/<docId>/v<n>.pdf and tracked via
 * the existing DocumentVersion table.
 *
 * Triggers:
 *   - v1: memo created (initial template, or pre-signed DocuSign PDF)
 *   - +1: initiator signs digitally post-submit (or re-signs)
 *   - +1: each approval-chain action (RECOMMEND/APPROVE/RETURN/REJECT)
 *   - +1: clarification provided
 *
 * Preview/Download surfaces always resolve `where isLatest = true` so
 * the user sees the current version, while every prior version stays
 * downloadable for legal-evidence and audit purposes.
 */

import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { generateMemoPdf, loadUserAssetPng } from "@/lib/memo-pdf";
import { logger } from "@/lib/logger";

const VERSIONS_DIR = path.join(process.cwd(), "uploads", "memo-versions");

export interface RecordVersionInput {
  documentId: string;
  pdfBytes: Uint8Array;
  changeNote: string;
  createdById: string;
  /** Optional file name suffix — defaults to v<n>.pdf. */
  fileName?: string;
}

/**
 * Persist a new memo version: writes the PDF to disk, demotes the
 * previous `isLatest`, inserts a DocumentVersion row marked latest.
 */
export async function recordMemoVersion(
  input: RecordVersionInput,
): Promise<{ versionNum: number; storagePath: string } | null> {
  try {
    // Find the next version number — sequential per document.
    const last = await db.documentVersion.findFirst({
      where: { documentId: input.documentId },
      orderBy: { versionNum: "desc" },
      select: { versionNum: true },
    });
    const versionNum = (last?.versionNum ?? 0) + 1;

    const dir = path.join(VERSIONS_DIR, input.documentId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = input.fileName ?? `v${versionNum}.pdf`;
    const absPath = path.join(dir, fileName);
    await fs.writeFile(absPath, input.pdfBytes);
    const relPath = path.posix.join(
      "uploads",
      "memo-versions",
      input.documentId,
      fileName,
    );

    // Atomic flip: demote prior latest, insert new latest.
    await db.$transaction([
      db.documentVersion.updateMany({
        where: { documentId: input.documentId, isLatest: true },
        data: { isLatest: false },
      }),
      db.documentVersion.create({
        data: {
          documentId: input.documentId,
          versionNum,
          storagePath: relPath,
          fileName,
          mimeType: "application/pdf",
          sizeBytes: BigInt(input.pdfBytes.length),
          changeNote: input.changeNote,
          isLatest: true,
          createdById: input.createdById,
        },
      }),
    ]);

    return { versionNum, storagePath: relPath };
  } catch (err) {
    logger.error("Failed to record memo version", err, {
      documentId: input.documentId,
      changeNote: input.changeNote,
    });
    return null;
  }
}

/**
 * Generate a fresh PDF snapshot of the *current* memo state via the
 * server-side renderer (lib/memo-pdf.ts) and record it as a new
 * version. Used by hooks that don't have a pre-rendered PDF on hand
 * (PATCH action handlers, etc.).
 */
export async function snapshotMemoVersion(
  workflowInstanceId: string,
  changeNote: string,
  createdById: string,
): Promise<{ versionNum: number } | null> {
  const instance = await db.workflowInstance.findUnique({
    where: { id: workflowInstanceId },
    include: { document: true },
  });
  if (!instance || !instance.documentId) return null;

  const formData = (instance.formData as Record<string, unknown>) ?? {};
  const meta = (instance.document?.metadata as Record<string, unknown>) ?? {};

  // Load the initiator's electronic signature + stamp so the snapshot
  // matches what the user previewed in the composer. For digital-
  // signature memos the WorkflowInstance.docusignSignedPdf is the
  // ground truth and should never reach this code path (the version
  // endpoint imports it directly).
  const initiatorId = (formData.fromId as string | undefined) ?? instance.initiatedById;
  const initiator = initiatorId
    ? await db.user.findUnique({
        where: { id: initiatorId },
        select: { signatureImage: true, officeStamp: true },
      })
    : null;
  const [signerSignaturePng, signerStampPng] = await Promise.all([
    loadUserAssetPng(initiator?.signatureImage),
    loadUserAssetPng(initiator?.officeStamp),
  ]);
  const memoRef =
    instance.document?.referenceNumber ??
    (formData.memoReference as string) ??
    instance.referenceNumber;
  const subject = instance.subject ?? instance.document?.title ?? "Memorandum";
  const bodyHtml =
    (formData.body as string) ??
    (meta.bodyHtml as string) ??
    instance.document?.description ??
    "";

  const pdfBytes = await generateMemoPdf({
    memoReference: memoRef,
    workflowReference: instance.referenceNumber,
    subject,
    body: bodyHtml,
    to: (formData.toName as string) ?? (meta.to as string) ?? "Recipient",
    from: (formData.fromName as string) ?? (meta.from as string) ?? "Sender",
    fromTitle:
      (formData.fromJobTitle as string) ?? (meta.designation as string) ?? "",
    fromDepartment:
      (formData.fromDepartment as string) ??
      (meta.departmentOffice as string) ??
      (meta.department as string) ??
      "",
    cc: (meta.copy_to as string) ?? "",
    date: new Date(instance.startedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    signerSignaturePng,
    signerStampPng,
  });

  const result = await recordMemoVersion({
    documentId: instance.documentId,
    pdfBytes,
    changeNote,
    createdById,
  });
  return result ? { versionNum: result.versionNum } : null;
}
