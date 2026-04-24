import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { logger } from "@/lib/logger";

export interface WatermarkOptions {
  userName: string;
  timestamp?: Date;
  label?: string;        // e.g. "CONFIDENTIAL", classification level
  opacity?: number;      // 0–1, default 0.12
  diagonal?: boolean;    // default true
}

/**
 * Stamp a PDF buffer with a diagonal watermark.
 * Returns the modified PDF bytes.
 * Never throws — on failure returns the original buffer unchanged.
 */
export async function applyWatermark(
  pdfBytes: Uint8Array | Buffer,
  opts: WatermarkOptions
): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);

    const ts = (opts.timestamp ?? new Date()).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const lines: string[] = [];
    if (opts.label) lines.push(opts.label.toUpperCase());
    lines.push(opts.userName);
    lines.push(ts);

    const opacity = opts.opacity ?? 0.12;
    const angle = opts.diagonal !== false ? 45 : 0;

    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const cx = width / 2;
      const cy = height / 2;

      const fontSize = Math.min(width, height) * 0.06;
      const lineH = fontSize * 1.4;

      lines.forEach((line, i) => {
        const tw = font.widthOfTextAtSize(line, fontSize);
        page.drawText(line, {
          x: cx - tw / 2,
          y: cy - lineH * (lines.length / 2 - i),
          size: fontSize,
          font,
          color: rgb(0.4, 0.4, 0.4),
          opacity,
          rotate: degrees(angle),
        });
      });
    }

    return await doc.save();
  } catch (err) {
    logger.warn("watermark: failed to apply, returning original", { err: String(err) });
    return pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes;
  }
}
