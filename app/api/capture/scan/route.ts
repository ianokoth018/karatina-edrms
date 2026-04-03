import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/** Map of common file extensions to MIME types. */
const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  tiff: "image/tiff",
  tif: "image/tiff",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  xml: "application/xml",
  json: "application/json",
  zip: "application/zip",
};

/** Resolve MIME type from extension. */
function mimeFromExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Compute SHA-256 hash of a file.
 */
async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Extract metadata from a filename using a mapping configuration.
 *
 * Mapping format:
 * ```json
 * { "pattern": "{regNumber}_{studentName}_{department}", "separator": "_" }
 * ```
 *
 * Given filename `REG001_JohnDoe_CS.pdf` this produces:
 * `{ regNumber: "REG001", studentName: "JohnDoe", department: "CS" }`
 */
function extractMetadata(
  fileNameWithoutExt: string,
  mapping: Record<string, unknown>
): Record<string, string> {
  const metadata: Record<string, string> = {};

  if (!mapping || !mapping.pattern || !mapping.separator) {
    return metadata;
  }

  const pattern = mapping.pattern as string;
  const separator = mapping.separator as string;

  // Extract field names from the pattern, e.g. "{regNumber}_{studentName}" => ["regNumber", "studentName"]
  const fieldNames: string[] = [];
  const fieldRegex = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(pattern)) !== null) {
    fieldNames.push(match[1]);
  }

  if (fieldNames.length === 0) return metadata;

  const parts = fileNameWithoutExt.split(separator);

  for (let i = 0; i < fieldNames.length && i < parts.length; i++) {
    metadata[fieldNames[i]] = parts[i];
  }

  return metadata;
}

/**
 * Parse an XML buddy file (scanner sidecar) to extract metadata.
 * Looks for a .xml file with the same base name as the document file.
 */
async function parseXmlBuddyFile(
  documentFilePath: string
): Promise<{ found: boolean; metadata: Record<string, string>; xmlPath: string | null }> {
  const dir = path.dirname(documentFilePath);
  const baseName = path.basename(documentFilePath, path.extname(documentFilePath));
  const xmlPath = path.join(dir, `${baseName}.xml`);

  try {
    await fs.access(xmlPath);
  } catch {
    return { found: false, metadata: {}, xmlPath: null };
  }

  try {
    const xmlContent = await fs.readFile(xmlPath, "utf-8");
    const metadata: Record<string, string> = {};

    const fieldRegex = /<field\s[^>]*?\bname\s*=\s*"([^"]*)"[^>]*?\bvalue\s*=\s*"([^"]*)"[^>]*?\/?>/gi;
    let match: RegExpExecArray | null;

    while ((match = fieldRegex.exec(xmlContent)) !== null) {
      const fieldName = match[1].trim();
      const fieldValue = match[2].trim();
      if (fieldName && fieldValue) {
        const key = fieldName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        metadata[key] = fieldValue;
        metadata[`_raw_${fieldName}`] = fieldValue;
      }
    }

    return { found: true, metadata, xmlPath };
  } catch {
    return { found: false, metadata: {}, xmlPath: null };
  }
}

/**
 * Generate a document reference number: CAP-000001, CAP-000002, ...
 */
async function nextReferenceNumber(): Promise<string> {
  const count = await db.document.count({
    where: { referenceNumber: { startsWith: "CAP-" } },
  });
  return "CAP-" + String(count + 1).padStart(6, "0");
}

/**
 * Core scan logic for a single capture profile.
 * Returns per-profile stats.
 */
export async function scanProfile(
  profile: {
    id: string;
    folderPath: string;
    processedPath: string | null;
    errorPath: string | null;
    fileTypes: string[];
    metadataMapping: unknown;
    duplicateAction: string;
    department: string | null;
    classificationNodeId: string | null;
    formTemplateId: string | null;
    createdById: string;
  },
  userId: string
): Promise<{ captured: number; duplicates: number; errors: number }> {
  let captured = 0;
  let duplicates = 0;
  let errors = 0;

  const uploadsDir = path.join(process.cwd(), "uploads", "edrms");

  // Ensure required directories exist
  await fs.mkdir(uploadsDir, { recursive: true });
  if (profile.processedPath) {
    await fs.mkdir(profile.processedPath, { recursive: true });
  }
  if (profile.errorPath) {
    await fs.mkdir(profile.errorPath, { recursive: true });
  }

  // Read the hot folder
  let entries: string[];
  try {
    entries = await fs.readdir(profile.folderPath);
  } catch (err) {
    logger.error("Cannot read hot folder", err, {
      route: "/api/capture/scan",
      action: "readdir",
    });
    // Create an error log for the entire folder read failure
    await db.captureLog.create({
      data: {
        profileId: profile.id,
        fileName: "*",
        filePath: profile.folderPath,
        status: "ERROR",
        errorMessage: `Cannot read folder: ${(err as Error).message}`,
        processedAt: new Date(),
      },
    });
    errors++;
    return { captured, duplicates, errors };
  }

  // Filter files by allowed extensions
  const allowedExts = new Set(
    profile.fileTypes.map((ft) => ft.toLowerCase().replace(/^\./, ""))
  );

  const files = entries.filter((entry) => {
    const ext = path.extname(entry).slice(1).toLowerCase();
    // Skip XML buddy files — they are consumed alongside their document pair
    if (ext === "xml") return false;
    return ext && allowedExts.has(ext);
  });

  for (const fileName of files) {
    const filePath = path.join(profile.folderPath, fileName);

    try {
      // Ensure it's a file, not a directory
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const fileSize = stat.size;

      // Compute SHA-256 hash for duplicate detection
      const fileHash = await hashFile(filePath);

      // Check for duplicates
      const existingLog = await db.captureLog.findFirst({
        where: {
          fileHash,
          status: { in: ["CAPTURED", "DUPLICATE"] },
        },
      });

      if (existingLog) {
        // Handle duplicate based on profile setting
        if (profile.duplicateAction === "SKIP") {
          await db.captureLog.create({
            data: {
              profileId: profile.id,
              fileName,
              filePath,
              fileSize: BigInt(fileSize),
              fileHash,
              status: "DUPLICATE",
              metadata: { action: "SKIPPED", originalLogId: existingLog.id },
              processedAt: new Date(),
            },
          });
          duplicates++;

          // Move to processed or delete
          if (profile.processedPath) {
            await fs.rename(
              filePath,
              path.join(profile.processedPath, fileName)
            );
          } else {
            await fs.unlink(filePath);
          }
          continue;
        } else if (profile.duplicateAction === "FLAG") {
          await db.captureLog.create({
            data: {
              profileId: profile.id,
              fileName,
              filePath,
              fileSize: BigInt(fileSize),
              fileHash,
              status: "DUPLICATE",
              metadata: { action: "FLAGGED", originalLogId: existingLog.id },
              processedAt: new Date(),
            },
          });
          duplicates++;
          // Leave file in place for manual review
          continue;
        }
        // VERSION: fall through to create as a new version
      }

      // Extract metadata from filename pattern
      const ext = path.extname(fileName).slice(1).toLowerCase();
      const nameWithoutExt = path.basename(fileName, path.extname(fileName));
      const mapping = profile.metadataMapping as Record<string, unknown>;
      const filenameMeta = extractMetadata(nameWithoutExt, mapping);

      // Check for XML buddy file (scanner sidecar)
      const xmlResult = await parseXmlBuddyFile(filePath);
      const extractedMetadata: Record<string, string> = {
        ...filenameMeta,        // filename pattern as baseline
        ...xmlResult.metadata,  // XML fields override
      };

      // Clean up the buddy XML if found
      if (xmlResult.found && xmlResult.xmlPath) {
        try {
          if (profile.processedPath) {
            await fs.rename(
              xmlResult.xmlPath,
              path.join(profile.processedPath, path.basename(xmlResult.xmlPath))
            );
          } else {
            await fs.unlink(xmlResult.xmlPath);
          }
        } catch { /* already gone */ }
      }

      // Build smart title from XML metadata
      const xmlStudentName = extractedMetadata.studentName || extractedMetadata["_raw_Student Name"];
      const xmlDocDesc = extractedMetadata.documentDescription || extractedMetadata["_raw_Document Description"];
      const xmlRegNumber = extractedMetadata.registrationNumber || extractedMetadata["_raw_Registration Number"];
      const smartTitle = xmlDocDesc && xmlStudentName
        ? `${xmlDocDesc} — ${xmlStudentName}${xmlRegNumber ? ` (${xmlRegNumber})` : ""}`
        : extractedMetadata.studentName
          ? `${extractedMetadata.studentName} - ${fileName}`
          : fileName;

      // Generate reference number
      const referenceNumber = await nextReferenceNumber();

      // Copy file to uploads directory and encrypt at rest
      const storageName = `${referenceNumber.replace(/[^A-Za-z0-9-]/g, "_")}_${fileName}`;
      const storagePath = path.join(uploadsDir, storageName);
      await fs.copyFile(filePath, storagePath);

      let encryptionIv: string | null = null;
      let encryptionTag: string | null = null;
      try {
        const { encryptFile } = await import("@/lib/encryption");
        const enc = await encryptFile(storagePath);
        encryptionIv = enc.iv;
        encryptionTag = enc.tag;
      } catch { /* encryption key not configured — store unencrypted */ }

      // Create Document record
      const document = await db.document.create({
        data: {
          referenceNumber,
          title: smartTitle,
          documentType: "CAPTURED",
          department: profile.department ?? "GENERAL",
          createdById: profile.createdById,
          sourceSystem: "HOT_FOLDER",
          sourceId: profile.id,
          classificationNodeId: profile.classificationNodeId ?? undefined,
          metadata: {
            formTemplateId: profile.formTemplateId ?? null,
            captureProfileId: profile.id,
            xmlSource: xmlResult.found,
            // Clean camelCase keys for querying
            ...Object.fromEntries(
              Object.entries(extractedMetadata).filter(([k]) => !k.startsWith("_raw_"))
            ),
            // Original field name → value for display
            _fieldLabels: Object.fromEntries(
              Object.entries(extractedMetadata)
                .filter(([k]) => k.startsWith("_raw_"))
                .map(([k, v]) => [k.replace("_raw_", ""), v])
            ),
          },
          files: {
            create: {
              storagePath: `uploads/edrms/${storageName}`,
              fileName,
              mimeType: mimeFromExt(ext),
              sizeBytes: BigInt(fileSize),
              encryptionIv,
              encryptionTag,
            },
          },
        },
      });

      // Create CaptureLog entry
      await db.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          fileSize: BigInt(fileSize),
          fileHash,
          status: existingLog ? "DUPLICATE" : "CAPTURED",
          documentId: document.id,
          metadata: {
            ...extractedMetadata,
            referenceNumber,
            duplicateAction: existingLog ? "VERSION" : undefined,
          },
          processedAt: new Date(),
        },
      });

      if (existingLog) {
        duplicates++;
      } else {
        captured++;
      }

      // Move source file to processedPath or delete
      if (profile.processedPath) {
        await fs.rename(filePath, path.join(profile.processedPath, fileName));
      } else {
        await fs.unlink(filePath);
      }
    } catch (err) {
      errors++;
      logger.error("Failed to capture file", err, {
        route: "/api/capture/scan",
        action: "captureFile",
      });

      // Log the error
      await db.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          status: "ERROR",
          errorMessage: (err as Error).message,
          processedAt: new Date(),
        },
      });

      // Move failed file to errorPath if configured
      if (profile.errorPath) {
        try {
          await fs.rename(filePath, path.join(profile.errorPath, fileName));
        } catch {
          // If move also fails, leave the file in place
        }
      }
    }
  }

  // Update lastScanAt
  await db.captureProfile.update({
    where: { id: profile.id },
    data: { lastScanAt: new Date() },
  });

  return { captured, duplicates, errors };
}

// ---------------------------------------------------------------------------
// POST /api/capture/scan -- scan ALL active capture profiles
// ---------------------------------------------------------------------------
export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profiles = await db.captureProfile.findMany({
      where: { isActive: true },
    });

    let totalCaptured = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    for (const profile of profiles) {
      const result = await scanProfile(profile, session.user.id);
      totalCaptured += result.captured;
      totalDuplicates += result.duplicates;
      totalErrors += result.errors;
    }

    await writeAudit({
      userId: session.user.id,
      action: "capture.scan_all",
      resourceType: "CaptureProfile",
      metadata: {
        scanned: profiles.length,
        captured: totalCaptured,
        duplicates: totalDuplicates,
        errors: totalErrors,
      },
    });

    return NextResponse.json({
      scanned: profiles.length,
      captured: totalCaptured,
      duplicates: totalDuplicates,
      errors: totalErrors,
    });
  } catch (error) {
    logger.error("Failed to scan capture profiles", error, {
      route: "/api/capture/scan",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
