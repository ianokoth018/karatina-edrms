/**
 * Bates numbering — lawyer-grade sequential page identifiers for document
 * productions. Each page of every document in a production receives the
 * next Bates number in a global sequence (e.g. "KCAA-000001",
 * "KCAA-000002", ...). A 23-page memo with start=1 gets stamps
 * "KCAA-000001..000023".
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";

/**
 * Format a Bates number from prefix + zero-padded sequence value.
 *   formatBatesNumber("KCAA", 6, 47) → "KCAA-000047"
 */
export function formatBatesNumber(prefix: string, pad: number, n: number): string {
  const padded = String(n).padStart(Math.max(1, pad), "0");
  return `${prefix}-${padded}`;
}

/**
 * Transactionally bump a sequence's `nextValue` by `pageCount` and return
 * the inclusive [start, end] allocation. Uses a PostgreSQL row-level lock
 * via the surrounding transaction so concurrent productions never collide.
 */
export async function allocateBatesRange(
  sequenceId: string,
  pageCount: number
): Promise<{ start: number; end: number }> {
  if (pageCount <= 0) {
    throw new Error("pageCount must be positive");
  }
  return db.$transaction(async (tx) => {
    // Pessimistic read — Postgres advisory lock keyed off the sequence id
    // serialises concurrent allocators against this exact sequence.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sequenceId}))`;
    const seq = await tx.batesSequence.findUnique({
      where: { id: sequenceId },
      select: { nextValue: true },
    });
    if (!seq) throw new Error("Bates sequence not found");
    const start = seq.nextValue;
    const end = start + pageCount - 1;
    await tx.batesSequence.update({
      where: { id: sequenceId },
      data: { nextValue: end + 1 },
    });
    return { start, end };
  });
}

/**
 * Stamp every page of a PDF with its Bates number, anchored to the
 * bottom-right corner in tiny dark-grey 8pt text.
 *   stampPdfPages(bytes, "KCAA", 6, 47)  // page 1 → "KCAA-000047", page 2 → "KCAA-000048", ...
 */
export async function stampPdfPages(
  pdfBytes: Uint8Array | Buffer,
  prefix: string,
  pad: number,
  startNum: number
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 8;
  const margin = 18; // ~quarter inch from page edge
  const color = rgb(0.25, 0.25, 0.25); // dark grey

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width } = page.getSize();
    const label = formatBatesNumber(prefix, pad, startNum + i);
    const tw = font.widthOfTextAtSize(label, fontSize);
    page.drawText(label, {
      x: width - margin - tw,
      y: margin,
      size: fontSize,
      font,
      color,
    });
  }

  return await doc.save();
}

/**
 * Count pages in a PDF buffer using pdf-lib.
 */
export async function countPdfPages(pdfBytes: Uint8Array | Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
