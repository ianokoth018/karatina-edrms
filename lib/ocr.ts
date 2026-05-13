import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import pLimit from "p-limit";
import { extractOcrWords } from "@/lib/ocr-bbox";

// Cap concurrent OCR jobs — ocrmypdf is CPU-intensive
const ocrConcurrencyLimit = pLimit(3);

const execFileAsync = promisify(execFile);

// Minimum characters-per-page to consider a PDF already text-bearing
const MIN_TEXT_DENSITY = 50;

/**
 * Extract text from a PDF that already has a text layer.
 * Returns null if pdf-parse is unavailable or the file isn't a PDF.
 */
async function extractTextLayer(filePath: string): Promise<string | null> {
  try {
    // Dynamic import so this never breaks the build if pdf-parse is missing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("pdf-parse") as any;
    const pdfParse = mod.default ?? mod;
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);
    return result.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Run ocrmypdf to add a searchable text layer to a scanned PDF.
 * Replaces the original file with the OCR'd version.
 * Returns the extracted text, or null if ocrmypdf is not available.
 */
async function runOcrMyPdf(filePath: string): Promise<string | null> {
  const tmpPath = filePath.replace(/\.pdf$/i, `_ocr_${Date.now()}.pdf`);
  try {
    // --skip-text: skip pages that already have a text layer
    // --output-type pdf: standard PDF output
    await execFileAsync("ocrmypdf", [
      "--skip-text",
      "--output-type", "pdf",
      "--quiet",
      filePath,
      tmpPath,
    ]);

    // Replace original with OCR'd version
    await fs.rename(tmpPath, filePath);

    // Extract the newly embedded text
    return await extractTextLayer(filePath);
  } catch {
    // Clean up temp file if it exists
    await fs.unlink(tmpPath).catch(() => {});
    return null;
  }
}

/**
 * Check whether ocrmypdf is available on this system.
 */
async function ocrmypdfAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ocrmypdf", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Process a single DocumentFile for OCR / text extraction.
 *
 * Strategy:
 *  1. Run pdf-parse to extract any existing text layer.
 *  2. If text is substantial → done.
 *  3. If text is sparse (scanned PDF) and ocrmypdf is available →
 *     run OCR, replace file, re-extract text.
 *  4. If ocrmypdf is unavailable, store whatever partial text we have
 *     and mark status FAILED so staff know OCR was skipped.
 */
async function _processFileOcr(fileId: string): Promise<void> {
  const docFile = await db.documentFile.findUnique({
    where: { id: fileId },
    select: { id: true, storagePath: true, mimeType: true, ocrStatus: true },
  });

  if (!docFile) return;
  if (docFile.ocrStatus === "COMPLETE") return;
  if (!docFile.mimeType.startsWith("application/pdf") && !docFile.mimeType.startsWith("image/")) return;

  const absolutePath = path.join(process.cwd(), docFile.storagePath);

  try {
    await db.documentFile.update({ where: { id: fileId }, data: { ocrStatus: "PROCESSING" } });

    let text: string | null = null;

    if (docFile.mimeType === "application/pdf") {
      text = await extractTextLayer(absolutePath);
    }

    const pageEstimate = Math.max(1, (text?.length ?? 0) / 2000);
    const isDense = (text?.trim().length ?? 0) / pageEstimate >= MIN_TEXT_DENSITY;

    if (!isDense) {
      // Sparse text → try OCR
      const hasOcr = await ocrmypdfAvailable();
      if (hasOcr) {
        const ocrText = await runOcrMyPdf(absolutePath);
        if (ocrText) text = ocrText;
      } else {
        logger.info("ocrmypdf not available — skipping OCR for scanned PDF", { fileId });
      }
    }

    const finalText = text?.trim() ?? null;

    await db.documentFile.update({
      where: { id: fileId },
      data: {
        ocrText: finalText,
        ocrStatus: finalText ? "COMPLETE" : "FAILED",
      },
    });

    // Additive: extract per-word bounding boxes for the visual metadata
    // picker. Non-blocking — errors here MUST NOT mark the file's OCR as
    // failed, since the plain text layer is independent.
    if (finalText && docFile.mimeType === "application/pdf") {
      try {
        const pages = await extractOcrWords(absolutePath);
        const flat = pages.flatMap((p) =>
          p.words.map((w) => ({
            fileId,
            page: w.page,
            x: w.x,
            y: w.y,
            width: w.width,
            height: w.height,
            text: w.text,
            confidence: w.confidence,
          })),
        );
        if (flat.length > 0) {
          // Replace any previous words for idempotency.
          await db.ocrWord.deleteMany({ where: { fileId } });
          const CHUNK = 1000;
          for (let i = 0; i < flat.length; i += CHUNK) {
            await db.ocrWord.createMany({ data: flat.slice(i, i + CHUNK) });
          }
        }
        logger.info("OCR words extracted", { fileId, count: flat.length });
      } catch (err) {
        logger.info("OCR word extraction skipped (non-fatal)", {
          fileId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("OCR processing complete", {
      fileId,
      chars: finalText?.length ?? 0,
      status: finalText ? "COMPLETE" : "FAILED",
    });
  } catch (err) {
    logger.error("OCR processing error", err, { fileId });
    await db.documentFile.update({
      where: { id: fileId },
      data: { ocrStatus: "FAILED" },
    }).catch(() => {});
  }
}

export function processFileOcr(fileId: string): Promise<void> {
  return ocrConcurrencyLimit(() => _processFileOcr(fileId));
}
