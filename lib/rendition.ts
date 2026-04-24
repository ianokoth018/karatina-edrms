import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);

const RENDERABLE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/csv",
  "image/tiff",
  "image/jpeg",
  "image/png",
]);

export function isRenderable(mimeType: string): boolean {
  return RENDERABLE_MIMES.has(mimeType);
}

/**
 * Convert a file to PDF using LibreOffice headless.
 * Returns the path to the generated PDF, or null on failure.
 */
async function convertToPdfRendition(sourcePath: string): Promise<string | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edrms-rendition-"));
  try {
    await execFileAsync("soffice", [
      "--headless",
      "--norestore",
      "--nofirststartwizard",
      "--convert-to", "pdf",
      "--outdir", tmpDir,
      sourcePath,
    ], { timeout: 60_000 });

    const base = path.basename(sourcePath, path.extname(sourcePath));
    const pdfPath = path.join(tmpDir, `${base}.pdf`);

    const outputDir = path.dirname(sourcePath);
    const renditionName = `${base}.rendition.pdf`;
    const renditionPath = path.join(outputDir, renditionName);

    await fs.copyFile(pdfPath, renditionPath);
    await fs.rm(tmpDir, { recursive: true }).catch(() => null);

    return renditionPath;
  } catch (err) {
    logger.warn("rendition: conversion failed", { sourcePath, err: String(err) });
    await fs.rm(tmpDir, { recursive: true }).catch(() => null);
    return null;
  }
}

/**
 * Generate a PDF rendition for a DocumentFile.
 * Updates renditionPath + renditionStatus on the record.
 */
export async function generateRendition(fileId: string): Promise<void> {
  const docFile = await db.documentFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      storagePath: true,
      mimeType: true,
      encryptionIv: true,
      encryptionTag: true,
      renditionStatus: true,
    },
  });

  if (!docFile) return;
  if (!isRenderable(docFile.mimeType)) return;
  if (docFile.mimeType === "application/pdf") return;
  if (docFile.renditionStatus === "DONE") return;

  await db.documentFile.update({
    where: { id: fileId },
    data: { renditionStatus: "PENDING" },
  });

  try {
    const absolutePath = path.join(process.cwd(), docFile.storagePath);

    let workingPath = absolutePath;

    // If encrypted, decrypt to a temp file first
    if (docFile.encryptionIv && docFile.encryptionTag) {
      const { decryptFileToBuffer } = await import("@/lib/encryption");
      const buf = await decryptFileToBuffer(absolutePath, docFile.encryptionIv, docFile.encryptionTag);
      const tmpFile = absolutePath + ".plain_tmp";
      await fs.writeFile(tmpFile, buf);
      workingPath = tmpFile;
    }

    const renditionAbsPath = await convertToPdfRendition(workingPath);

    // Clean up temp decrypted file
    if (workingPath !== absolutePath) {
      await fs.unlink(workingPath).catch(() => null);
    }

    if (!renditionAbsPath) {
      await db.documentFile.update({
        where: { id: fileId },
        data: { renditionStatus: "FAILED" },
      });
      return;
    }

    const renditionStoragePath = path.relative(process.cwd(), renditionAbsPath);

    await db.documentFile.update({
      where: { id: fileId },
      data: {
        renditionPath: renditionStoragePath,
        renditionStatus: "DONE",
      },
    });

    logger.info("rendition: generated successfully", { fileId, renditionStoragePath });
  } catch (err) {
    logger.error("rendition: unexpected error", err, { fileId });
    await db.documentFile.update({
      where: { id: fileId },
      data: { renditionStatus: "FAILED" },
    }).catch(() => null);
  }
}
