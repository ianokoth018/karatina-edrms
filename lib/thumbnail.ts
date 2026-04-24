import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { logger } from "@/lib/logger";
// pdf-parse v2 ships ESM without a default export — import the namespace
// and pick whichever export is callable.
import * as pdfParseNs from "pdf-parse";
const pdfParse = (
  (pdfParseNs as unknown as { default?: unknown }).default ?? pdfParseNs
) as (data: Buffer) => Promise<{ text: string; numpages: number }>;

const execFileAsync = promisify(execFile);

const PDFTOPPM = "/usr/bin/pdftoppm";

/**
 * Generate a thumbnail PNG for a PDF file.
 * @param pdfPath - absolute path to source PDF
 * @param outputDir - directory to write thumbnail into
 * @param options.page - 1-based page number (default: 1)
 * @param options.dpi - resolution (default: 72)
 * @returns absolute path to the generated PNG file
 */
export async function generateThumbnail(
  pdfPath: string,
  outputDir: string,
  options: { page?: number; dpi?: number } = {}
): Promise<string> {
  const page = options.page ?? 1;
  const dpi = options.dpi ?? 72;
  const prefix = `thumb-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await fs.mkdir(outputDir, { recursive: true });

  const prefixPath = path.join(outputDir, prefix);

  logger.info("Generating PDF thumbnail", {
    action: "generateThumbnail",
    pdfPath,
    outputDir,
    page,
    dpi,
  });

  try {
    await execFileAsync(PDFTOPPM, [
      "-r",
      String(dpi),
      "-f",
      String(page),
      "-l",
      String(page),
      "-png",
      pdfPath,
      prefixPath,
    ]);
  } catch (err) {
    logger.error("pdftoppm failed during thumbnail generation", err instanceof Error ? err : undefined, {
      action: "generateThumbnail",
      pdfPath,
      page,
    });
    throw err;
  }

  // pdftoppm appends the page number, zero-padded if multi-page; for single-page
  // renders it uses "-1.png" when only one page is requested.
  const outputFile = `${prefixPath}-${page}.png`;

  try {
    await fs.access(outputFile);
    return outputFile;
  } catch {
    // pdftoppm may zero-pad; try with 1 explicitly
    const fallback = `${prefixPath}-1.png`;
    await fs.access(fallback);
    return fallback;
  }
}

/**
 * Generate thumbnails for all pages of a PDF.
 * @returns array of absolute PNG paths, one per page
 */
export async function generateAllThumbnails(
  pdfPath: string,
  outputDir: string,
  options: { dpi?: number } = {}
): Promise<string[]> {
  const dpi = options.dpi ?? 72;
  const prefix = `thumb-all-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await fs.mkdir(outputDir, { recursive: true });

  // Get page count via pdf-parse
  const bytes = await fs.readFile(pdfPath);
  const parsed = await pdfParse(bytes);
  const pageCount: number = parsed.numpages;

  logger.info("Generating thumbnails for all PDF pages", {
    action: "generateAllThumbnails",
    pdfPath,
    outputDir,
    pageCount,
    dpi,
  });

  const prefixPath = path.join(outputDir, prefix);

  try {
    await execFileAsync(PDFTOPPM, [
      "-r",
      String(dpi),
      "-png",
      pdfPath,
      prefixPath,
    ]);
  } catch (err) {
    logger.error("pdftoppm failed during all-page thumbnail generation", err instanceof Error ? err : undefined, {
      action: "generateAllThumbnails",
      pdfPath,
    });
    throw err;
  }

  // Collect all generated PNG files sorted by page number
  const files = await fs.readdir(outputDir);
  const thumbFiles = files
    .filter((f) => f.startsWith(prefix) && f.endsWith(".png"))
    .sort((a, b) => {
      const numA = parseInt(a.replace(`${prefix}-`, "").replace(".png", ""), 10);
      const numB = parseInt(b.replace(`${prefix}-`, "").replace(".png", ""), 10);
      return numA - numB;
    })
    .map((f) => path.join(outputDir, f));

  if (thumbFiles.length !== pageCount) {
    logger.warn("Thumbnail count mismatch", {
      action: "generateAllThumbnails",
      expected: pageCount,
      got: thumbFiles.length,
    });
  }

  return thumbFiles;
}
