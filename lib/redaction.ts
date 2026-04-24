import { PDFDocument, rgb } from "pdf-lib";
import { promises as fs } from "fs";
import { logger } from "@/lib/logger";

export interface RedactionRegion {
  page: number;    // 1-based
  x: number;       // points from left
  y: number;       // points from bottom
  width: number;
  height: number;
  reason?: string;
}

/**
 * Apply redaction regions to a PDF buffer.
 * Each region is covered with a solid black rectangle.
 * Returns the redacted PDF bytes.
 */
export async function applyRedactions(
  pdfBytes: Uint8Array | Buffer,
  regions: RedactionRegion[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  for (const region of regions) {
    const pageIdx = region.page - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    page.drawRectangle({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: rgb(0, 0, 0),
      opacity: 1,
    });
  }

  return doc.save();
}

/**
 * Read, decrypt if needed, redact, and save to a new file.
 * Returns the absolute path of the saved redacted file.
 */
export async function redactFile(
  sourcePath: string,
  outputPath: string,
  regions: RedactionRegion[],
  encryptionIv?: string | null,
  encryptionTag?: string | null
): Promise<void> {
  let raw: Buffer;
  if (encryptionIv && encryptionTag) {
    const { decryptFileToBuffer } = await import("@/lib/encryption");
    raw = await decryptFileToBuffer(sourcePath, encryptionIv, encryptionTag);
  } else {
    raw = await fs.readFile(sourcePath);
  }

  const redacted = await applyRedactions(raw, regions);
  await fs.writeFile(outputPath, redacted);
  logger.info("redaction: saved redacted file", { outputPath, regions: regions.length });
}
