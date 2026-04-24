import type { PrismaClient } from "@prisma/client";
import { markLatest } from "@/lib/version-control";
import { notifyVersionUploaded } from "@/lib/version-notifications";
import { logger } from "@/lib/logger";

export interface AutoVersionInput {
  documentId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  createdById: string;
  changeNote?: string;
  encryptionIv?: string | null;
  encryptionTag?: string | null;
}

/**
 * Automatically create the next version of a document.
 *
 * - Increments versionNum from the highest existing version
 * - Creates a DocumentVersion record with status DRAFT and isLatest=true
 * - Clears isLatest on all other versions
 * - Creates a DocumentFile record for OCR processing
 * - Fires upload notifications
 *
 * Returns the new version id and versionNum.
 */
export async function autoVersion(
  prisma: PrismaClient,
  input: AutoVersionInput
): Promise<{ versionId: string; versionNum: number }> {
  const {
    documentId,
    storagePath,
    fileName,
    mimeType,
    sizeBytes,
    createdById,
    changeNote,
    encryptionIv,
    encryptionTag,
  } = input;

  const latest = await prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { versionNum: "desc" },
    select: { versionNum: true },
  });

  const nextVersionNum = (latest?.versionNum ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    const ver = await tx.documentVersion.create({
      data: {
        documentId,
        versionNum: nextVersionNum,
        storagePath,
        fileName,
        mimeType,
        sizeBytes,
        changeNote: changeNote ?? `Version ${nextVersionNum} — auto-versioned`,
        createdById,
        status: "DRAFT",
        isLatest: true,
        ...(encryptionIv ? { encryptionIv } : {}),
        ...(encryptionTag ? { encryptionTag } : {}),
      },
    });

    await tx.documentFile.create({
      data: {
        documentId,
        storagePath,
        fileName,
        mimeType,
        sizeBytes,
        ocrStatus: "PENDING",
        ...(encryptionIv ? { encryptionIv } : {}),
        ...(encryptionTag ? { encryptionTag } : {}),
      },
    });

    return ver;
  });

  await markLatest(prisma, documentId, version.id);

  const uploader = await prisma.user.findUnique({
    where: { id: createdById },
    select: { displayName: true },
  });

  await notifyVersionUploaded(
    prisma,
    documentId,
    nextVersionNum,
    uploader?.displayName ?? createdById
  ).catch((err) =>
    logger.warn("autoVersion: notifyVersionUploaded failed", { err: String(err) })
  );

  logger.info("autoVersion: created version", {
    documentId,
    versionNum: nextVersionNum,
    versionId: version.id,
    fileName,
  });

  return { versionId: version.id, versionNum: nextVersionNum };
}
