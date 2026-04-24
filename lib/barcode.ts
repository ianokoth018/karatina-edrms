import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
// pdf-parse v2 ships an ESM index without a default export. Import the
// namespace and pick whichever export is actually callable.
import * as pdfParseNs from "pdf-parse";
const pdfParse = (
  (pdfParseNs as unknown as { default?: unknown }).default ?? pdfParseNs
) as (data: Buffer) => Promise<{ text: string }>;
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

const PDFTOPPM = "/usr/bin/pdftoppm";

export interface BarcodeResult {
  type: "QR_CODE" | "CODE128" | "CODE39" | "EAN13" | "PDF417" | "UNKNOWN";
  data: string;
  page: number;
  confidence: "high" | "medium" | "low";
}

/**
 * Check if zbarimg is available for high-accuracy barcode scanning.
 */
export async function isZbarimgAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["zbarimg"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the PDF date string format: D:YYYYMMDDHHmmSSOHH'mm'
 * Returns null if unparseable.
 */
function parsePdfDate(raw: string): Date | null {
  // Strip leading D: prefix and surrounding parentheses if present
  const cleaned = raw.replace(/^\(/, "").replace(/\)$/, "").replace(/^D:/, "");
  // Minimum: YYYYMMDD (8 chars)
  if (cleaned.length < 8) return null;
  const year = parseInt(cleaned.slice(0, 4), 10);
  const month = parseInt(cleaned.slice(4, 6), 10) - 1;
  const day = parseInt(cleaned.slice(6, 8), 10);
  const hour = cleaned.length >= 10 ? parseInt(cleaned.slice(8, 10), 10) : 0;
  const min = cleaned.length >= 12 ? parseInt(cleaned.slice(10, 12), 10) : 0;
  const sec = cleaned.length >= 14 ? parseInt(cleaned.slice(12, 14), 10) : 0;
  const d = new Date(Date.UTC(year, month, day, hour, min, sec));
  if (isNaN(d.getTime())) return null;
  return d;
}

// Exported so other modules can use if needed (suppresses unused-var lint)
export { parsePdfDate };

/**
 * Strategy 1: Extract text via pdf-parse and search for barcode-like patterns.
 */
async function textLayerSearch(buffer: Buffer): Promise<BarcodeResult[]> {
  const results: BarcodeResult[] = [];
  try {
    const parsed = await pdfParse(buffer);
    const text = parsed.text ?? "";

    // CODE39: delimited by asterisks
    const code39Re = /\*[A-Z0-9 $%+\-.\/]+\*/g;
    let m: RegExpExecArray | null;
    while ((m = code39Re.exec(text)) !== null) {
      results.push({
        type: "CODE39",
        data: m[0].replace(/\*/g, "").trim(),
        page: 1,
        confidence: "low",
      });
    }

    // Student IDs / reference numbers: 2–4 uppercase letters followed by 6–12 digits
    const refRe = /\b([A-Z]{2,4}\d{6,12})\b/g;
    while ((m = refRe.exec(text)) !== null) {
      results.push({
        type: "UNKNOWN",
        data: m[1],
        page: 1,
        confidence: "low",
      });
    }

    // ISBN-13 / ISBN-10
    const isbnRe = /(?:ISBN[-: ]?)(97[89][-\d]{10,17})/gi;
    while ((m = isbnRe.exec(text)) !== null) {
      results.push({
        type: "EAN13",
        data: m[1].replace(/[-\s]/g, ""),
        page: 1,
        confidence: "low",
      });
    }
  } catch (err) {
    logger.warn("barcode: text-layer search failed", { err: String(err) });
  }
  return results;
}

/**
 * Strategy 2: Search raw PDF bytes for embedded barcode markers.
 */
function rawByteSearch(buffer: Buffer): BarcodeResult[] {
  const results: BarcodeResult[] = [];
  try {
    const raw = buffer.toString("latin1");

    // QR code markers in XMP metadata or XObject streams
    if (raw.includes("/QRCode")) {
      // Try to capture adjacent stream data as a hint
      const qrRe = /\/QRCode[^\n]*\n?([^\n]{0,120})/g;
      let m: RegExpExecArray | null;
      while ((m = qrRe.exec(raw)) !== null) {
        const snippet = m[1].trim().replace(/[^\x20-\x7E]/g, "").slice(0, 80);
        if (snippet.length > 0) {
          results.push({
            type: "QR_CODE",
            data: snippet,
            page: 1,
            confidence: "low",
          });
        } else {
          results.push({
            type: "QR_CODE",
            data: "(embedded QR detected — data opaque)",
            page: 1,
            confidence: "low",
          });
        }
      }
    }

    // Barcode widget annotations: /Subtype /Widget with /BS /W (border style width)
    // Presence suggests the PDF contains a barcode form field
    if (raw.includes("/Subtype /Widget") && raw.includes("/BS")) {
      // Extract field names (/T) near widget dicts
      const widgetRe = /\/Subtype\s*\/Widget[\s\S]{0,300}?\/T\s*\(([^)]{1,60})\)/g;
      let m: RegExpExecArray | null;
      while ((m = widgetRe.exec(raw)) !== null) {
        const fieldName = m[1].trim();
        // Only include if the field name hints at a barcode
        if (/barcode|qr|code|scan/i.test(fieldName)) {
          results.push({
            type: "UNKNOWN",
            data: fieldName,
            page: 1,
            confidence: "low",
          });
        }
      }
    }

    // PDF417 markers
    if (raw.includes("/PDF417") || raw.includes("/Pdf417")) {
      results.push({
        type: "PDF417",
        data: "(PDF417 barcode field detected)",
        page: 1,
        confidence: "low",
      });
    }
  } catch (err) {
    logger.warn("barcode: raw byte search failed", { err: String(err) });
  }
  return results;
}

/**
 * Strategy 3: zbarimg — render page 1 as PNG via pdftoppm, then scan.
 * Only called when zbarimg is confirmed available.
 */
async function zbarimgSearch(pdfPath: string): Promise<BarcodeResult[]> {
  const results: BarcodeResult[] = [];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edrms-barcode-"));
  const prefix = path.join(tmpDir, "page");

  try {
    // Render page 1 to PNG at 150 dpi
    await execFileAsync(PDFTOPPM, ["-r", "150", "-f", "1", "-l", "1", "-png", pdfPath, prefix]);

    // pdftoppm names output: {prefix}-1.png (zero-padded based on page count)
    // For single page it's typically {prefix}-1.png
    const files = await fs.readdir(tmpDir);
    const pngFiles = files
      .filter((f) => f.endsWith(".png"))
      .map((f) => path.join(tmpDir, f))
      .sort();

    for (const pngFile of pngFiles) {
      try {
        const { stdout } = await execFileAsync("zbarimg", ["--raw", pngFile]);
        const lines = stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;
          const rawType = line.slice(0, colonIdx).trim().toUpperCase();
          const data = line.slice(colonIdx + 1).trim();
          const type = mapZbarType(rawType);
          results.push({ type, data, page: 1, confidence: "high" });
        }
      } catch {
        // zbarimg exits non-zero when no barcode found — not an error
      }
    }
  } catch (err) {
    logger.warn("barcode: zbarimg strategy failed", { pdfPath, err: String(err) });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return results;
}

function mapZbarType(
  raw: string
): "QR_CODE" | "CODE128" | "CODE39" | "EAN13" | "PDF417" | "UNKNOWN" {
  if (raw.includes("QRCODE") || raw.includes("QR")) return "QR_CODE";
  if (raw.includes("CODE-128") || raw.includes("CODE128")) return "CODE128";
  if (raw.includes("CODE-39") || raw.includes("CODE39")) return "CODE39";
  if (raw.includes("EAN-13") || raw.includes("EAN13")) return "EAN13";
  if (raw.includes("PDF417")) return "PDF417";
  return "UNKNOWN";
}

/** Deduplicate results by (type, data) pairs. */
function dedup(results: BarcodeResult[]): BarcodeResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.type}::${r.data}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Detect barcodes and QR codes in a PDF file.
 * Uses multiple strategies; returns empty array if none found.
 */
export async function detectBarcodes(pdfPath: string): Promise<BarcodeResult[]> {
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(pdfPath);
  } catch (err) {
    logger.error("barcode: could not read PDF", err instanceof Error ? err : undefined, {
      pdfPath,
    });
    return [];
  }

  const all: BarcodeResult[] = [];

  // Strategy 1: text layer
  const textResults = await textLayerSearch(buffer);
  all.push(...textResults);

  // Strategy 2: raw bytes
  const rawResults = rawByteSearch(buffer);
  all.push(...rawResults);

  // Strategy 3: zbarimg if available
  try {
    const zbarAvail = await isZbarimgAvailable();
    if (zbarAvail) {
      const zbarResults = await zbarimgSearch(pdfPath);
      all.push(...zbarResults);
    }
  } catch (err) {
    logger.warn("barcode: zbarimg availability check failed", { err: String(err) });
  }

  const unique = dedup(all);
  logger.info("barcode: detection complete", { pdfPath, found: unique.length });
  return unique;
}

/**
 * Extract the first barcode value from a PDF, or null if none found.
 * Convenience wrapper for capture pipeline use.
 */
export async function extractFirstBarcode(pdfPath: string): Promise<string | null> {
  const results = await detectBarcodes(pdfPath);
  // Prefer high-confidence results
  const high = results.find((r) => r.confidence === "high");
  if (high) return high.data;
  const medium = results.find((r) => r.confidence === "medium");
  if (medium) return medium.data;
  return results[0]?.data ?? null;
}
