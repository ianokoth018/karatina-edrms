import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

const LEVEL_MAP: Record<"1b" | "2b" | "3b", number> = {
  "1b": 1,
  "2b": 2,
  "3b": 3,
};

/**
 * Convert a PDF to PDF/A-2b format using Ghostscript.
 * Returns the output path on success, or null if gs is not available or conversion fails.
 */
export async function convertToPdfA(
  inputPath: string,
  outputPath: string,
  level: "1b" | "2b" | "3b" = "2b"
): Promise<string | null> {
  if (!(await isPdfAAvailable())) {
    logger.warn("Ghostscript not available; skipping PDF/A conversion", {
      action: "convertToPdfA",
      inputPath,
    });
    return null;
  }

  const levelNumber = LEVEL_MAP[level];

  logger.info("Converting PDF to PDF/A", {
    action: "convertToPdfA",
    inputPath,
    outputPath,
    level,
  });

  try {
    await execFileAsync("gs", [
      "-dBATCH",
      "-dNOPAUSE",
      "-dNOSAFER",
      "-sDEVICE=pdfwrite",
      `-dPDFA=${levelNumber}`,
      "-dPDFACompatibilityPolicy=1",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);

    logger.info("PDF/A conversion successful", {
      action: "convertToPdfA",
      outputPath,
    });

    return outputPath;
  } catch (err) {
    logger.error("Ghostscript PDF/A conversion failed", err instanceof Error ? err : undefined, {
      action: "convertToPdfA",
      inputPath,
      outputPath,
    });
    return null;
  }
}

/**
 * Check if PDF/A conversion is available (Ghostscript installed).
 */
export async function isPdfAAvailable(): Promise<boolean> {
  try {
    await execFileAsync("gs", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify if a PDF is already PDF/A compliant by checking XMP metadata.
 * Returns the conformance level (e.g., "PDF/A-2b") or null if not PDF/A.
 */
export async function getPdfAConformance(pdfPath: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(pdfPath);
    const content = bytes.toString("latin1");

    // Extract PDF/A part (1, 2, 3) from XMP
    const partMatch = /<pdfaid:part>([^<]+)<\/pdfaid:part>/.exec(content);
    // Extract PDF/A conformance level (A, B, U) from XMP
    const conformanceMatch = /<pdfaid:conformance>([^<]+)<\/pdfaid:conformance>/.exec(content);

    if (partMatch && conformanceMatch) {
      const part = partMatch[1].trim();
      const conformance = conformanceMatch[1].trim().toLowerCase();
      const result = `PDF/A-${part}${conformance}`;

      logger.info("PDF/A conformance detected", {
        action: "getPdfAConformance",
        pdfPath,
        conformance: result,
      });

      return result;
    }

    logger.info("PDF is not PDF/A compliant", {
      action: "getPdfAConformance",
      pdfPath,
    });

    return null;
  } catch (err) {
    logger.error("Failed to check PDF/A conformance", err instanceof Error ? err : undefined, {
      action: "getPdfAConformance",
      pdfPath,
    });
    return null;
  }
}
