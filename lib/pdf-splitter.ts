import * as fs from "fs/promises";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { detectBlankPages } from "@/lib/pdf-quality";
import { logger } from "@/lib/logger";

export interface SplitResult {
  outputPaths: string[];
  pageRanges: Array<[number, number]>; // 1-based [start, end]
}

/**
 * Write a segment of pages (0-based indices) from srcDoc to a new PDF file.
 */
async function writeSegment(
  srcDoc: PDFDocument,
  zeroBasedIndices: number[],
  outputPath: string
): Promise<void> {
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(srcDoc, zeroBasedIndices);
  for (const page of copied) {
    newDoc.addPage(page);
  }
  const bytes = await newDoc.save();
  await fs.writeFile(outputPath, bytes);
}

/**
 * Split a PDF into chunks of N pages each.
 */
export async function splitByPageCount(
  pdfPath: string,
  outputDir: string,
  pagesPerDoc: number
): Promise<SplitResult> {
  if (pagesPerDoc < 1) {
    throw new RangeError("pagesPerDoc must be >= 1");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const bytes = await fs.readFile(pdfPath);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

  logger.info("Splitting PDF by page count", {
    action: "splitByPageCount",
    pdfPath,
    outputDir,
    pagesPerDoc,
    totalPages,
  });

  const outputPaths: string[] = [];
  const pageRanges: Array<[number, number]> = [];

  let segIndex = 0;
  for (let start = 0; start < totalPages; start += pagesPerDoc) {
    const end = Math.min(start + pagesPerDoc - 1, totalPages - 1);
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const outputPath = path.join(outputDir, `split-${segIndex + 1}.pdf`);

    await writeSegment(srcDoc, indices, outputPath);

    outputPaths.push(outputPath);
    pageRanges.push([start + 1, end + 1]);
    segIndex++;
  }

  logger.info("PDF split by page count complete", {
    action: "splitByPageCount",
    segments: outputPaths.length,
  });

  return { outputPaths, pageRanges };
}

/**
 * Split a PDF at blank separator pages.
 * Blank pages become separators and are excluded from output documents.
 * Segments with 0 content pages are skipped.
 */
export async function splitByBlankPage(
  pdfPath: string,
  outputDir: string
): Promise<SplitResult> {
  await fs.mkdir(outputDir, { recursive: true });

  const bytes = await fs.readFile(pdfPath);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

  logger.info("Splitting PDF by blank separator pages", {
    action: "splitByBlankPage",
    pdfPath,
    outputDir,
    totalPages,
  });

  const blankPages = await detectBlankPages(pdfPath);
  const blankSet = new Set(blankPages);

  // Build segments: groups of consecutive non-blank pages between blank separators
  const segments: Array<number[]> = [];
  let currentSegment: number[] = [];

  for (let page = 1; page <= totalPages; page++) {
    if (blankSet.has(page)) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    } else {
      currentSegment.push(page);
    }
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  const outputPaths: string[] = [];
  const pageRanges: Array<[number, number]> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const zeroBasedIndices = seg.map((p) => p - 1);
    const outputPath = path.join(outputDir, `split-${i + 1}.pdf`);

    await writeSegment(srcDoc, zeroBasedIndices, outputPath);

    outputPaths.push(outputPath);
    pageRanges.push([seg[0], seg[seg.length - 1]]);
  }

  logger.info("PDF split by blank page complete", {
    action: "splitByBlankPage",
    segments: outputPaths.length,
    blankPagesFound: blankPages.length,
  });

  return { outputPaths, pageRanges };
}

/**
 * Split a PDF at explicit page numbers.
 * @param splitAfterPages - 1-based page numbers after which to split
 */
export async function splitAtPages(
  pdfPath: string,
  outputDir: string,
  splitAfterPages: number[]
): Promise<SplitResult> {
  await fs.mkdir(outputDir, { recursive: true });

  const bytes = await fs.readFile(pdfPath);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();

  logger.info("Splitting PDF at explicit page boundaries", {
    action: "splitAtPages",
    pdfPath,
    outputDir,
    splitAfterPages,
    totalPages,
  });

  // Build sorted unique split points clamped to valid range
  const splitPoints = Array.from(new Set(splitAfterPages))
    .filter((p) => p >= 1 && p < totalPages)
    .sort((a, b) => a - b);

  // Build ranges: [1..split[0]], [split[0]+1..split[1]], ..., [split[n-1]+1..totalPages]
  const ranges: Array<[number, number]> = [];
  let rangeStart = 1;
  for (const splitAt of splitPoints) {
    ranges.push([rangeStart, splitAt]);
    rangeStart = splitAt + 1;
  }
  ranges.push([rangeStart, totalPages]);

  const outputPaths: string[] = [];
  const pageRanges: Array<[number, number]> = [];

  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    const zeroBasedIndices = Array.from(
      { length: end - start + 1 },
      (_, idx) => start - 1 + idx
    );
    const outputPath = path.join(outputDir, `split-${i + 1}.pdf`);

    await writeSegment(srcDoc, zeroBasedIndices, outputPath);

    outputPaths.push(outputPath);
    pageRanges.push([start, end]);
  }

  logger.info("PDF split at explicit pages complete", {
    action: "splitAtPages",
    segments: outputPaths.length,
  });

  return { outputPaths, pageRanges };
}
