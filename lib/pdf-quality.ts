import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { PDFDocument } from "pdf-lib";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

const PDFTOPPM = "/usr/bin/pdftoppm";

/** Byte size threshold below which a rendered page is considered potentially blank. */
const BLANK_SIZE_THRESHOLD = 6000;

/** How many bytes to sample when checking for high average byte value. */
const SAMPLE_SIZE = 2000;

/** Minimum average byte value to consider a page blank (0xFF = 255). */
const BLANK_BYTE_THRESHOLD = 240;

/**
 * Detect blank pages in a PDF.
 * A page is blank if its rendered image has >98% white pixels (approximated by
 * file size < 6000 bytes AND high average byte value in a sample of the file).
 * @returns sorted array of 1-based blank page numbers
 */
export async function detectBlankPages(pdfPath: string): Promise<number[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-quality-"));
  const prefix = path.join(tmpDir, "page");

  logger.info("Detecting blank pages in PDF", {
    action: "detectBlankPages",
    pdfPath,
  });

  try {
    await execFileAsync(PDFTOPPM, [
      "-r",
      "36",
      "-png",
      pdfPath,
      prefix,
    ]);

    const files = await fs.readdir(tmpDir);
    const pageFiles = files
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.replace("page-", "").replace(".png", ""), 10);
        const numB = parseInt(b.replace("page-", "").replace(".png", ""), 10);
        return numA - numB;
      });

    const blankPages: number[] = [];

    for (let i = 0; i < pageFiles.length; i++) {
      const filePath = path.join(tmpDir, pageFiles[i]);
      const stat = await fs.stat(filePath);

      if (stat.size < BLANK_SIZE_THRESHOLD) {
        // Secondary check: read a sample and compute average byte value
        const fd = await fs.open(filePath, "r");
        try {
          const sampleLen = Math.min(SAMPLE_SIZE, stat.size);
          const buffer = Buffer.alloc(sampleLen);
          await fd.read(buffer, 0, sampleLen, 0);
          let sum = 0;
          for (let b = 0; b < sampleLen; b++) {
            sum += buffer[b];
          }
          const avg = sampleLen > 0 ? sum / sampleLen : 0;
          if (avg >= BLANK_BYTE_THRESHOLD) {
            blankPages.push(i + 1);
          }
        } finally {
          await fd.close();
        }
      }
    }

    logger.info("Blank page detection complete", {
      action: "detectBlankPages",
      pdfPath,
      blankPages,
    });

    return blankPages.sort((a, b) => a - b);
  } catch (err) {
    logger.error("Failed to detect blank pages", err instanceof Error ? err : undefined, {
      action: "detectBlankPages",
      pdfPath,
    });
    throw err;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Remove blank pages from a PDF.
 * @returns { outputPath, removedPages, totalPages }
 */
export async function removeBlankPages(
  pdfPath: string,
  outputPath: string
): Promise<{ removedPages: number[]; totalPages: number }> {
  logger.info("Removing blank pages from PDF", {
    action: "removeBlankPages",
    pdfPath,
    outputPath,
  });

  const blankPages = await detectBlankPages(pdfPath);
  const bytes = await fs.readFile(pdfPath);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

  const blankSet = new Set(blankPages);
  const keepIndices: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    // pages are 1-based in our blankPages array, 0-based in pdf-lib
    if (!blankSet.has(i + 1)) {
      keepIndices.push(i);
    }
  }

  const newDoc = await PDFDocument.create();
  const copiedPages = await newDoc.copyPages(srcDoc, keepIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  const outBytes = await newDoc.save();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, outBytes);

  logger.info("Blank pages removed", {
    action: "removeBlankPages",
    pdfPath,
    outputPath,
    removedPages: blankPages,
    totalPages,
    keptPages: keepIndices.length,
  });

  return { removedPages: blankPages, totalPages };
}
