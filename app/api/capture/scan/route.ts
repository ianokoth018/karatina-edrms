import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { parseXmlBuddyFile as sharedParseXmlBuddyFile } from "@/lib/xml-buddy";
import { validateMetadata } from "@/lib/capture-validator";
import type { Prisma } from "@prisma/client";

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
 * Poll for a sibling XML buddy file to appear alongside a document. Scanners
 * often drop the PDF first and the XML a beat or two later; without waiting
 * we'd commit the PDF with empty casefolder metadata.
 *
 * Only call this when the profile actually expects an XML (e.g. linked to a
 * casefolder). Returns true if found, false if the timeout elapsed.
 */
async function waitForXmlBuddy(
  documentFilePath: string,
  maxWaitMs = 5000,
  pollIntervalMs = 500
): Promise<boolean> {
  const dir = path.dirname(documentFilePath);
  const baseName = path.basename(documentFilePath, path.extname(documentFilePath));
  const xmlPath = path.join(dir, `${baseName}.xml`);
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const stat = await fs.stat(xmlPath);
      if (stat.size > 0) return true;
    } catch { /* not present yet */ }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/**
 * Symmetric to waitForXmlBuddy: poll for any sibling document file whose
 * basename matches the XML's basename AND whose extension is in the
 * profile's allowed fileTypes (excluding xml). Returns the absolute path of
 * the first match, or null if the timeout elapsed.
 */
async function waitForPdfBuddy(
  xmlFilePath: string,
  fileTypes: string[],
  maxWaitMs = 5000,
  pollIntervalMs = 500
): Promise<string | null> {
  const dir = path.dirname(xmlFilePath);
  const baseName = path.basename(xmlFilePath, path.extname(xmlFilePath));
  const candidateExts = fileTypes
    .map((ft) => ft.toLowerCase().replace(/^\./, ""))
    .filter((ext) => ext && ext !== "xml");
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    for (const ext of candidateExts) {
      const candidate = path.join(dir, `${baseName}.${ext}`);
      try {
        const stat = await fs.stat(candidate);
        if (stat.size > 0) return candidate;
      } catch { /* not present yet */ }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null;
}

/**
 * Single-shot sibling-document check (no polling): returns the absolute path
 * of a sibling file whose basename matches the XML's basename and whose
 * extension is in the profile's allowed fileTypes (excluding xml), or null.
 */
async function findSiblingDocument(
  xmlFilePath: string,
  fileTypes: string[]
): Promise<string | null> {
  const dir = path.dirname(xmlFilePath);
  const baseName = path.basename(xmlFilePath, path.extname(xmlFilePath));
  const candidateExts = fileTypes
    .map((ft) => ft.toLowerCase().replace(/^\./, ""))
    .filter((ext) => ext && ext !== "xml");
  for (const ext of candidateExts) {
    const candidate = path.join(dir, `${baseName}.${ext}`);
    try {
      const stat = await fs.stat(candidate);
      if (stat.size > 0) return candidate;
    } catch { /* not present */ }
  }
  return null;
}

/**
 * Handle a standalone XML sidecar whose paired document was already captured.
 * Looks for a recent CaptureLog (last 60s) sharing the basename and, if found,
 * merges the XML metadata into the linked Document.
 */
async function handleOrphanXml(
  xmlPath: string,
  profile: {
    id: string;
    processedPath: string | null;
    errorPath: string | null;
    fileTypes: string[];
    formTemplateId: string | null;
  }
): Promise<boolean> {
  const xmlName = path.basename(xmlPath);
  const baseName = path.basename(xmlPath, path.extname(xmlPath));

  // 1. If a sibling document file exists right now, let the document's own
  //    capture branch handle the pairing. Do not delete/move the XML.
  if (profile.formTemplateId) {
    const sibling = await findSiblingDocument(xmlPath, profile.fileTypes);
    if (sibling) {
      logger.info(
        `Standalone XML "${xmlName}" — sibling ${path.basename(sibling)} already present; document handler will pair`,
        { route: "/api/capture/scan", action: "handleOrphanXml" }
      );
      return false;
    }
  }

  // 2. Orphan-repair for late-arriving XMLs (unchanged 60s window).
  const cutoff = new Date(Date.now() - 60_000);
  const orphan = await db.captureLog.findFirst({
    where: {
      profileId: profile.id,
      status: "CAPTURED",
      documentId: { not: null },
      createdAt: { gte: cutoff },
      fileName: { startsWith: `${baseName}.` },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!orphan || !orphan.documentId) {
    // 3. No orphan to repair. For casefolder-linked profiles, enforce the
    //    mandatory PDF-buddy rule: wait up to 5s; if the PDF arrives, the
    //    document branch handles it. Otherwise move to errorPath / delete
    //    and log an ERROR CaptureLog with reason MISSING_PDF_BUDDY.
    if (profile.formTemplateId) {
      const pdfArrived = await waitForPdfBuddy(
        xmlPath,
        profile.fileTypes,
        5000
      );
      if (pdfArrived) {
        logger.info(
          `Standalone XML "${xmlName}" — PDF ${path.basename(pdfArrived)} arrived during wait; document handler will pair`,
          { route: "/api/capture/scan", action: "handleOrphanXml" }
        );
        return false;
      }

      // Verify the XML is still present (the doc branch may have consumed it)
      try {
        await fs.access(xmlPath);
      } catch {
        return false;
      }

      logger.warn(
        `Incomplete buddy pair — XML "${xmlName}" arrived without its PDF sidecar`,
        {
          route: "/api/capture/scan",
          action: "handleOrphanXml",
          basename: baseName,
          reason: "MISSING_PDF_BUDDY",
        }
      );

      let movedTo: string | null = null;
      if (profile.errorPath) {
        try {
          movedTo = path.join(profile.errorPath, xmlName);
          await fs.rename(xmlPath, movedTo);
        } catch (moveErr) {
          logger.error("Failed to move incomplete XML to errorPath", moveErr, {
            route: "/api/capture/scan",
            action: "handleOrphanXml",
          });
          movedTo = null;
        }
      } else {
        try { await fs.unlink(xmlPath); } catch { /* already gone */ }
      }

      await db.captureLog.create({
        data: {
          profileId: profile.id,
          fileName: xmlName,
          filePath: movedTo ?? xmlPath,
          // CaptureStatus enum has no FAILED value and schema changes are
          // forbidden; ERROR is the existing semantic for a failure that
          // yields no Document. Discriminator lives in metadata.reason.
          status: "ERROR",
          errorMessage:
            "Incomplete buddy pair — XML arrived without its PDF sidecar",
          metadata: { reason: "MISSING_PDF_BUDDY", basename: baseName },
          processedAt: new Date(),
        },
      });
      return true;
    }

    // Non-casefolder profile — XML is an accident. Move aside silently.
    if (profile.errorPath) {
      try {
        await fs.rename(xmlPath, path.join(profile.errorPath, xmlName));
      } catch { /* already gone */ }
    } else {
      try { await fs.unlink(xmlPath); } catch { /* already gone */ }
    }
    return false;
  }

  const parsed = await parseXmlBuddyFile(
    path.join(path.dirname(xmlPath), `${baseName}.xml`)
  );
  if (!parsed.found) return false;

  const doc = await db.document.findUnique({
    where: { id: orphan.documentId },
    select: { id: true, metadata: true },
  });
  if (!doc) return false;

  // Re-map XML raw names via the casefolder template when available. The
  // template id is stored in document.metadata.formTemplateId (set at capture
  // time); fall back to the profile's template.
  const remapped: Record<string, string> = {};
  const docMetaInitial = (doc.metadata ?? {}) as Record<string, unknown>;
  const templateId =
    (typeof docMetaInitial.formTemplateId === "string"
      ? (docMetaInitial.formTemplateId as string)
      : null) ?? profile.formTemplateId;
  if (templateId) {
    const template = await db.formTemplate.findUnique({
      where: { id: templateId },
      select: { fields: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields = (template?.fields as any[]) ?? [];
    for (const cf of fields) {
      if (!cf?.name) continue;
      const xmlName = cf.xmlFieldName || cf.label;
      if (xmlName) {
        const raw = parsed.metadata[`_raw_${xmlName}`];
        if (raw) remapped[cf.name] = raw;
      }
    }
  }

  const existing = (doc.metadata ?? {}) as Record<string, unknown>;
  const existingLabels =
    (existing._fieldLabels as Record<string, string>) ?? {};
  const cleanXml = Object.fromEntries(
    Object.entries(parsed.metadata).filter(([k]) => !k.startsWith("_raw_"))
  );
  const xmlLabels = Object.fromEntries(
    Object.entries(parsed.metadata)
      .filter(([k]) => k.startsWith("_raw_"))
      .map(([k, v]) => [k.replace("_raw_", ""), v])
  );

  await db.document.update({
    where: { id: doc.id },
    data: {
      metadata: {
        ...existing,
        ...cleanXml,
        ...remapped,
        xmlSource: true,
        _fieldLabels: { ...existingLabels, ...xmlLabels },
      },
    },
  });

  // Move or delete the XML so we don't re-process it.
  if (profile.processedPath) {
    try {
      await fs.rename(xmlPath, path.join(profile.processedPath, xmlName));
    } catch { /* already gone */ }
  } else {
    try { await fs.unlink(xmlPath); } catch { /* already gone */ }
  }

  // Traceability log. CaptureStatus has no METADATA_PATCHED value and the
  // task forbids schema changes, so we store the sentinel in metadata.action
  // and use CAPTURED for the row status.
  await db.captureLog.create({
    data: {
      profileId: profile.id,
      fileName: xmlName,
      filePath: xmlPath,
      status: "CAPTURED",
      documentId: doc.id,
      metadata: {
        action: "METADATA_PATCHED",
        patchedFromLogId: orphan.id,
        fields: cleanXml,
      },
      processedAt: new Date(),
    },
  });

  logger.info("Orphan XML patched into existing document", {
    route: "/api/capture/scan",
    action: "metadataPatch",
    documentId: doc.id,
    originLogId: orphan.id,
  });
  return true;
}

/**
 * Parse an XML buddy file (scanner sidecar) to extract metadata.
 * Delegates to the shared parser in `@/lib/xml-buddy`, which uses
 * fast-xml-parser for proper handling of attribute order, quote style,
 * XML entities, and child-element field variants.
 */
async function parseXmlBuddyFile(
  documentFilePath: string
): Promise<{ found: boolean; metadata: Record<string, string>; xmlPath: string | null }> {
  const result = await sharedParseXmlBuddyFile(documentFilePath);
  return {
    found: result.found,
    metadata: result.metadata,
    xmlPath: result.xmlPath,
  };
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
    validationRules?: unknown;
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

  // Partition entries: XML sidecars are handled by the orphan-repair backstop
  // at the end of the scan (after all document files have had a chance to be
  // committed), while document files go through the main capture pipeline.
  const xmlFiles: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).slice(1).toLowerCase();
    if (ext === "xml") {
      xmlFiles.push(entry);
    } else if (ext && allowedExts.has(ext)) {
      files.push(entry);
    }
  }

  for (const fileName of files) {
    const filePath = path.join(profile.folderPath, fileName);

    try {
      // Ensure it's a file, not a directory
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const fileSize = stat.size;

      // Wait for the XML buddy when the profile expects one, BEFORE hashing
      // or dedup, so a late-arriving XML doesn't cause us to process the same
      // basename twice on a subsequent scan.
      //
      // NEW (mandatory buddy-pair rule): for casefolder-linked profiles the
      // PDF and XML are a REQUIRED pair. If the XML never arrives, we must
      // NOT file the PDF with filename-only metadata — move to errorPath (or
      // delete) and log an ERROR CaptureLog with reason MISSING_XML_BUDDY.
      const expectsXml = !!profile.formTemplateId;
      if (expectsXml) {
        const found = await waitForXmlBuddy(filePath, 5000);
        logger.info(
          `XML buddy wait for ${fileName}: ${found ? "found" : "timed out"}`,
          { route: "/api/capture/scan", action: "waitForXmlBuddy" }
        );
        if (!found) {
          const baseName = path.basename(fileName, path.extname(fileName));
          logger.warn(
            `Incomplete buddy pair — PDF "${fileName}" arrived without its XML sidecar`,
            {
              route: "/api/capture/scan",
              action: "mandatoryBuddyPair",
              basename: baseName,
              reason: "MISSING_XML_BUDDY",
            }
          );

          let movedTo: string | null = null;
          if (profile.errorPath) {
            try {
              movedTo = path.join(profile.errorPath, fileName);
              await fs.rename(filePath, movedTo);
            } catch (moveErr) {
              logger.error(
                "Failed to move incomplete PDF to errorPath",
                moveErr,
                { route: "/api/capture/scan", action: "mandatoryBuddyPair" }
              );
              movedTo = null;
            }
          } else {
            try { await fs.unlink(filePath); } catch { /* already gone */ }
          }

          await db.captureLog.create({
            data: {
              profileId: profile.id,
              fileName,
              filePath: movedTo ?? filePath,
              // CaptureStatus enum has no FAILED value and schema changes
              // are forbidden; ERROR is the existing failure semantic.
              status: "ERROR",
              errorMessage:
                "Incomplete buddy pair — PDF arrived without its XML sidecar",
              metadata: {
                reason: "MISSING_XML_BUDDY",
                basename: baseName,
              },
              processedAt: new Date(),
            },
          });
          errors++;
          continue;
        }
      }

      // Extract metadata — XML buddy first, then filename pattern. Done before
      // hashing/dedup so the decision to create a new document or new version
      // is made with full knowledge of the metadata.
      const extForMeta = path.extname(fileName).slice(1).toLowerCase();
      const nameWithoutExtEarly = path.basename(fileName, path.extname(fileName));
      const mappingEarly = profile.metadataMapping as Record<string, unknown>;
      const filenameMetaEarly = extractMetadata(nameWithoutExtEarly, mappingEarly);
      const xmlResultEarly = await parseXmlBuddyFile(filePath);
      const extractedMetadata: Record<string, string> = {
        ...filenameMetaEarly,
        ...xmlResultEarly.metadata,
      };

      // Per-field validation — if rules are defined on the profile, evaluate
      // them before dedup/commit. On failure we create a CaptureException
      // (status=PENDING) and leave the file in place for admin review.
      if (profile.validationRules) {
        const validation = await validateMetadata(
          profile.validationRules,
          extractedMetadata,
          db
        );
        if (!validation.valid) {
          await db.captureException.create({
            data: {
              profileId: profile.id,
              filePath,
              extractedMetadata,
              errors: validation.errors as unknown as Prisma.InputJsonValue,
              status: "PENDING",
            },
          });
          await db.captureLog.create({
            data: {
              profileId: profile.id,
              fileName,
              filePath,
              fileSize: BigInt(fileSize),
              status: "VALIDATION_FAILED",
              errorMessage: `Metadata validation failed (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"})`,
              metadata: {
                extractedMetadata,
                validationErrors: validation.errors,
              } as unknown as Prisma.InputJsonValue,
              processedAt: new Date(),
            },
          });
          logger.warn("Capture validation failed — file left in place", {
            route: "/api/capture/scan",
            action: "validateMetadata",
            profileId: profile.id,
            fileName,
            errors: validation.errors,
          });
          errors++;
          continue;
        }
      }

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

      // Metadata already extracted above (XML + filename pattern); alias for
      // readability in the commit block below.
      const ext = extForMeta;
      const xmlResult = xmlResultEarly;

      // Clean up the buddy XML if found (deferred until after dedup so a
      // skipped duplicate does not consume its sidecar)
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

  // Orphan-XML repair pass: for each stray XML, if a recent CaptureLog (last
  // 60s) links to a document with the same basename, merge the XML metadata
  // into that document. Otherwise leave the XML in place — the PDF is likely
  // still inbound and a future scan will consume the pair normally.
  for (const xmlEntry of xmlFiles) {
    const xmlPath = path.join(profile.folderPath, xmlEntry);
    try {
      const xmlStat = await fs.stat(xmlPath);
      if (!xmlStat.isFile()) continue;
      await handleOrphanXml(xmlPath, profile);
    } catch (err) {
      logger.error("Orphan XML repair failed", err, {
        route: "/api/capture/scan",
        action: "handleOrphanXml",
        file: xmlEntry,
      });
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
