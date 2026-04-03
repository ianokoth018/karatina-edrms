/**
 * Capture Worker — Hot Folder Document Ingestion Service
 *
 * Standalone Node.js background service that watches hot folders defined in
 * CaptureProfiles and automatically processes new files into the EDRMS.
 *
 * Usage:
 *   npx tsx scripts/capture-worker.ts
 *
 * Add to package.json scripts:
 *   "capture": "npx tsx scripts/capture-worker.ts"
 */

import { PrismaClient } from "@prisma/client";
import chokidar, { type FSWatcher } from "chokidar";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROFILE_REFRESH_INTERVAL_MS = 60_000; // re-fetch profiles every 60s
const FILE_SETTLE_DELAY_MS = 500; // wait for file write to complete
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "edrms");

// ---------------------------------------------------------------------------
// Logging helpers (timestamp + colour)
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

function timestamp(): string {
  return new Date().toISOString();
}

const log = {
  info(msg: string, meta?: Record<string, unknown>) {
    const metaStr = meta ? ` ${DIM}${JSON.stringify(meta)}${RESET}` : "";
    console.log(`${DIM}[${timestamp()}]${RESET} ${CYAN}INFO${RESET}  ${msg}${metaStr}`);
  },
  success(msg: string, meta?: Record<string, unknown>) {
    const metaStr = meta ? ` ${DIM}${JSON.stringify(meta)}${RESET}` : "";
    console.log(`${DIM}[${timestamp()}]${RESET} ${GREEN}${BOLD}OK${RESET}    ${msg}${metaStr}`);
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    const metaStr = meta ? ` ${DIM}${JSON.stringify(meta)}${RESET}` : "";
    console.log(`${DIM}[${timestamp()}]${RESET} ${YELLOW}WARN${RESET}  ${msg}${metaStr}`);
  },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>) {
    const metaStr = meta ? ` ${DIM}${JSON.stringify(meta)}${RESET}` : "";
    const errMsg = err instanceof Error ? err.message : String(err ?? "");
    console.error(
      `${DIM}[${timestamp()}]${RESET} ${RED}${BOLD}ERR${RESET}   ${msg}${errMsg ? ` — ${RED}${errMsg}${RESET}` : ""}${metaStr}`
    );
  },
  debug(msg: string) {
    if (process.env.DEBUG) {
      console.log(`${DIM}[${timestamp()}] DEBUG ${msg}${RESET}`);
    }
  },
};

// ---------------------------------------------------------------------------
// MIME type lookup from extension
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
};

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  return MIME_MAP[ext] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaptureProfileRecord {
  id: string;
  name: string;
  folderPath: string;
  processedPath: string | null;
  errorPath: string | null;
  fileTypes: string[];
  isActive: boolean;
  formTemplateId: string | null;
  department: string | null;
  classificationNodeId: string | null;
  metadataMapping: unknown;
  duplicateAction: string;
  createdById: string;
}

interface ActiveWatcher {
  profileId: string;
  profileName: string;
  watcher: FSWatcher;
}

// ---------------------------------------------------------------------------
// Prisma client (standalone — not the Next.js singleton)
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const watchers = new Map<string, ActiveWatcher>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

// ---------------------------------------------------------------------------
// Reference number generation (mirrors lib/reference.ts)
// ---------------------------------------------------------------------------

async function generateReference(prefix: string, department: string): Promise<string> {
  const year = new Date().getFullYear();
  const deptAbbr = department.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "GEN";
  const pattern = `${prefix}-${year}-${deptAbbr}-`;

  const count = await prisma.document.count({
    where: {
      referenceNumber: { startsWith: pattern },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  return `${pattern}${sequence}`;
}

// ---------------------------------------------------------------------------
// Metadata extraction from filename
// ---------------------------------------------------------------------------

function extractMetadata(
  fileName: string,
  mapping: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};

  if (!mapping || typeof mapping !== "object") return result;

  const pattern = mapping.pattern as string | undefined;
  if (!pattern) return result;

  const separator = (mapping.separator as string) || "_";

  // Strip extension from filename
  const baseName = path.basename(fileName, path.extname(fileName));

  // Parse the pattern to find field names in {braces}
  // e.g. pattern = "{regNumber}_{studentName}_{department}"
  // with separator = "_"
  const patternParts = pattern.split(separator);
  const filenameParts = baseName.split(separator);

  for (let i = 0; i < patternParts.length && i < filenameParts.length; i++) {
    const part = patternParts[i].trim();
    const match = part.match(/^\{(\w+)\}$/);
    if (match) {
      const fieldName = match[1];
      result[fieldName] = filenameParts[i].trim();
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// XML buddy file parser — extracts metadata from scanner sidecar XML
// ---------------------------------------------------------------------------

/**
 * Scans for a buddy XML file matching a given document file.
 * Scanner output convention: "filename.pdf" has "filename.xml" alongside it.
 *
 * XML format (from Karatina scanners):
 * ```xml
 * <root>
 *   <document>
 *     <field level="batch" name="Student Name" value="JOY WANJIRU THUKU"/>
 *     <field level="batch" name="Registration Number" value="E112-3127G-24"/>
 *     <field level="document" name="Document Description" value="ADMISSION LETTER"/>
 *   </document>
 * </root>
 * ```
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

    // Parse <field ... name="X" value="Y" /> elements using regex
    // Handles attributes in any order: name/value/level
    const fieldRegex = /<field\s[^>]*?\bname\s*=\s*"([^"]*)"[^>]*?\bvalue\s*=\s*"([^"]*)"[^>]*?\/?>/gi;
    let match: RegExpExecArray | null;

    while ((match = fieldRegex.exec(xmlContent)) !== null) {
      const fieldName = match[1].trim();
      const fieldValue = match[2].trim();
      if (fieldName && fieldValue) {
        // Convert "Student Name" → "studentName" for metadata key
        const key = fieldName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        metadata[key] = fieldValue;

        // Also store with original field name for display
        metadata[`_raw_${fieldName}`] = fieldValue;
      }
    }

    log.info(
      `XML buddy file found: ${BLUE}${path.basename(xmlPath)}${RESET} — ${Object.keys(metadata).filter((k) => !k.startsWith("_raw_")).length} fields extracted`
    );

    return { found: true, metadata, xmlPath };
  } catch (err) {
    log.warn(`Failed to parse XML buddy file: ${xmlPath} — ${err instanceof Error ? err.message : err}`);
    return { found: false, metadata: {}, xmlPath };
  }
}

// ---------------------------------------------------------------------------
// SHA-256 hash computation
// ---------------------------------------------------------------------------

async function computeFileHash(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------
// Safe file move (copy + unlink, cross-device safe)
// ---------------------------------------------------------------------------

async function moveFile(src: string, destDir: string, fileName: string): Promise<string> {
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, fileName);

  // Handle filename collisions
  let finalDest = dest;
  let counter = 1;
  while (true) {
    try {
      await fs.access(finalDest);
      // File exists — append counter
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      finalDest = path.join(destDir, `${base}_${counter}${ext}`);
      counter++;
    } catch {
      // File does not exist — good to go
      break;
    }
  }

  await fs.copyFile(src, finalDest);
  await fs.unlink(src);
  return finalDest;
}

// ---------------------------------------------------------------------------
// Core: process a single detected file
// ---------------------------------------------------------------------------

async function processFile(
  filePath: string,
  profile: CaptureProfileRecord
): Promise<void> {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase().replace(".", "");

  log.info(`Processing file: ${MAGENTA}${fileName}${RESET}`, {
    profile: profile.name,
  });

  // 1a. Skip XML buddy files — they are consumed alongside their document pair
  if (ext === "xml") {
    log.debug(`Skipping XML buddy file (will be consumed with its document pair): ${fileName}`);
    return;
  }

  // 1b. Check file extension against allowed types
  const allowedExts = profile.fileTypes.map((ft) => ft.toLowerCase().replace(".", ""));
  if (!allowedExts.includes(ext)) {
    log.warn(`Skipping "${fileName}" — extension ".${ext}" not in allowed types [${allowedExts.join(", ")}]`);
    await prisma.captureLog.create({
      data: {
        profileId: profile.id,
        fileName,
        filePath,
        status: "SKIPPED",
        errorMessage: `File extension ".${ext}" not allowed for this profile`,
      },
    });
    return;
  }

  // 2. Wait for file write to settle
  await sleep(FILE_SETTLE_DELAY_MS);

  // 3. Verify file still exists (may have been moved by another process)
  try {
    await fs.access(filePath);
  } catch {
    log.warn(`File vanished before processing: ${fileName}`);
    return;
  }

  // 4. Get file stats
  const stats = await fs.stat(filePath);

  // 5. Compute SHA-256 hash
  const fileHash = await computeFileHash(filePath);
  log.debug(`Hash for "${fileName}": ${fileHash}`);

  // 6. Check for duplicates in capture_logs
  const existingLog = await prisma.captureLog.findFirst({
    where: {
      fileHash,
      status: "CAPTURED",
    },
  });

  if (existingLog) {
    log.warn(`Duplicate detected for "${fileName}" (hash matches log #${existingLog.id})`);

    if (profile.duplicateAction === "SKIP") {
      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          fileSize: BigInt(stats.size),
          fileHash,
          status: "DUPLICATE",
          errorMessage: `Duplicate of previously captured file (log: ${existingLog.id})`,
        },
      });

      // Move to processed or delete
      if (profile.processedPath) {
        await moveFile(filePath, profile.processedPath, fileName);
        log.info(`Duplicate moved to processed: ${profile.processedPath}`);
      } else {
        await fs.unlink(filePath);
        log.info(`Duplicate deleted: ${fileName}`);
      }
      return;
    }

    if (profile.duplicateAction === "FLAG") {
      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          fileSize: BigInt(stats.size),
          fileHash,
          status: "DUPLICATE",
          errorMessage: `Flagged as duplicate (hash matches log: ${existingLog.id})`,
          metadata: { duplicateOf: existingLog.id, documentId: existingLog.documentId },
        },
      });

      // Move to error path for manual review
      if (profile.errorPath) {
        await moveFile(filePath, profile.errorPath, fileName);
        log.info(`Flagged duplicate moved to error path for review: ${profile.errorPath}`);
      }
      return;
    }

    // duplicateAction === "VERSION" — fall through and create as new version
    log.info(`Duplicate action is VERSION — processing as new document`);
  }

  // 7. Extract metadata — XML buddy file takes priority, then filename pattern
  const metadataMapping = (profile.metadataMapping ?? {}) as Record<string, unknown>;
  const filenameMeta = extractMetadata(fileName, metadataMapping);

  // Check for XML buddy file (scanner sidecar)
  const xmlResult = await parseXmlBuddyFile(filePath);
  const extractedMeta: Record<string, string> = {
    ...filenameMeta,      // filename pattern fields as baseline
    ...xmlResult.metadata, // XML fields override filename fields
  };

  // Clean up the buddy XML file if found
  if (xmlResult.found && xmlResult.xmlPath) {
    if (profile.processedPath) {
      await moveFile(xmlResult.xmlPath, profile.processedPath, path.basename(xmlResult.xmlPath));
      log.debug(`XML buddy moved to processed: ${profile.processedPath}`);
    } else {
      try {
        await fs.unlink(xmlResult.xmlPath);
        log.debug(`XML buddy deleted: ${xmlResult.xmlPath}`);
      } catch { /* already gone */ }
    }
  }

  // 8. Resolve form template name for documentType
  let documentType = "CAPTURED";
  let formTemplateName: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let casefolderFields: any[] = [];

  if (profile.formTemplateId) {
    const template = await prisma.formTemplate.findUnique({
      where: { id: profile.formTemplateId },
      select: { name: true, fields: true },
    });
    if (template) {
      formTemplateName = template.name;
      documentType = template.name;
      casefolderFields = (template.fields as unknown[]) as { xmlFieldName?: string; name?: string; label?: string; fieldLevel?: string; usedInTitle?: boolean }[];

      // Re-map XML metadata using casefolder field definitions
      // Match XML raw field names to casefolder field names
      if (xmlResult.found && Array.isArray(casefolderFields)) {
        const remapped: Record<string, string> = {};
        for (const cf of casefolderFields) {
          if (!cf.name) continue;
          const xmlName = cf.xmlFieldName || cf.label;
          if (xmlName) {
            // Look for the raw XML value by original field name
            const rawValue = extractedMeta[`_raw_${xmlName}`];
            if (rawValue) {
              remapped[cf.name] = rawValue;
            }
          }
        }
        // Merge casefolder-mapped fields into extractedMeta (override generic keys)
        Object.assign(extractedMeta, remapped);
      }
    }
  }

  // Build auto-title from fields marked as usedInTitle
  const titleParts: string[] = [];
  if (Array.isArray(casefolderFields)) {
    for (const cf of casefolderFields) {
      if (cf.usedInTitle && cf.name && extractedMeta[cf.name]) {
        titleParts.push(extractedMeta[cf.name]);
      }
    }
  }

  // 9. Generate reference number
  const department = profile.department || "GENERAL";
  const referenceNumber = await generateReference("CAP", department);

  // 10. Copy file to uploads/edrms/ directory and encrypt at rest
  const uploadDir = path.join(UPLOADS_DIR, referenceNumber);
  await fs.mkdir(uploadDir, { recursive: true });
  const destPath = path.join(uploadDir, fileName);
  await fs.copyFile(filePath, destPath);
  const storagePath = `uploads/edrms/${referenceNumber}/${fileName}`;

  // Encrypt the file at rest using AES-256-GCM
  let encryptionIv: string | null = null;
  let encryptionTag: string | null = null;
  try {
    const { encryptFile } = await import("../lib/encryption");
    const enc = await encryptFile(destPath);
    encryptionIv = enc.iv;
    encryptionTag = enc.tag;
    log.info(`File encrypted at rest: ${BLUE}${fileName}${RESET}`);
  } catch (encErr) {
    log.warn(`Encryption skipped (key not configured): ${encErr instanceof Error ? encErr.message : encErr}`);
  }

  // 11. Create Document + DocumentFile + CaptureLog in a transaction
  const { document, captureLog } = await prisma.$transaction(async (tx) => {
    // Build title: use casefolder-defined title fields, then XML fallback, then filename
    const smartTitle = titleParts.length > 0
      ? titleParts.join(" — ")
      : (() => {
          const xmlStudentName = extractedMeta.studentName || extractedMeta["_raw_Student Name"];
          const xmlDocDesc = extractedMeta.documentDescription || extractedMeta["_raw_Document Description"];
          const xmlRegNumber = extractedMeta.registrationNumber || extractedMeta["_raw_Registration Number"];
          if (xmlDocDesc && xmlStudentName)
            return `${xmlDocDesc} — ${xmlStudentName}${xmlRegNumber ? ` (${xmlRegNumber})` : ""}`;
          if (formTemplateName) return `${formTemplateName} — ${fileName}`;
          return `Captured: ${fileName}`;
        })();

    const doc = await tx.document.create({
      data: {
        referenceNumber,
        title: smartTitle,
        description: `Auto-captured from hot folder "${profile.name}"${xmlResult.found ? " (with XML metadata)" : ""}`,
        documentType,
        status: "ACTIVE",
        department,
        classificationNodeId: profile.classificationNodeId || null,
        createdById: profile.createdById,
        sourceSystem: "CAPTURE",
        contentHash: fileHash,
        metadata: {
          formTemplateId: profile.formTemplateId,
          captureProfileId: profile.id,
          captureProfileName: profile.name,
          originalPath: filePath,
          xmlSource: xmlResult.found,
          // Store clean camelCase keys for querying
          ...Object.fromEntries(
            Object.entries(extractedMeta).filter(([k]) => !k.startsWith("_raw_"))
          ),
          // Store original field name → value mapping for display
          _fieldLabels: Object.fromEntries(
            Object.entries(extractedMeta)
              .filter(([k]) => k.startsWith("_raw_"))
              .map(([k, v]) => [k.replace("_raw_", ""), v])
          ),
        },
        files: {
          create: {
            storagePath,
            fileName,
            mimeType: getMimeType(fileName),
            sizeBytes: BigInt(stats.size),
            ocrStatus: "PENDING",
            encryptionIv,
            encryptionTag,
          },
        },
        versions: {
          create: {
            versionNum: 1,
            storagePath,
            sizeBytes: BigInt(stats.size),
            changeNote: "Auto-captured from hot folder",
            createdById: profile.createdById,
          },
        },
      },
    });

    const logEntry = await tx.captureLog.create({
      data: {
        profileId: profile.id,
        fileName,
        filePath,
        fileSize: BigInt(stats.size),
        fileHash,
        status: "CAPTURED",
        documentId: doc.id,
        metadata: extractedMeta,
        processedAt: new Date(),
      },
    });

    return { document: doc, captureLog: logEntry };
  });

  // 12. Move original file to processedPath or delete it
  if (profile.processedPath) {
    await moveFile(filePath, profile.processedPath, fileName);
    log.debug(`Original moved to: ${profile.processedPath}/${fileName}`);
  } else {
    await fs.unlink(filePath);
    log.debug(`Original deleted: ${filePath}`);
  }

  // 13. Update profile lastScanAt
  await prisma.captureProfile.update({
    where: { id: profile.id },
    data: { lastScanAt: new Date() },
  });

  log.success(
    `Captured "${BLUE}${fileName}${RESET}" -> ${BOLD}${referenceNumber}${RESET} (doc: ${document.id})`,
    {
      profile: profile.name,
      logId: captureLog.id,
      hash: fileHash.slice(0, 12) + "...",
      size: stats.size,
    }
  );
}

// ---------------------------------------------------------------------------
// Error-safe wrapper for file processing
// ---------------------------------------------------------------------------

async function safeProcessFile(
  filePath: string,
  profile: CaptureProfileRecord
): Promise<void> {
  const fileName = path.basename(filePath);

  try {
    await processFile(filePath, profile);
  } catch (err) {
    log.error(`Failed to process "${fileName}"`, err, { profile: profile.name });

    // Create error log entry
    try {
      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          status: "ERROR",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch (logErr) {
      log.error("Failed to write error log entry", logErr);
    }

    // Move file to error path if configured
    if (profile.errorPath) {
      try {
        await moveFile(filePath, profile.errorPath, fileName);
        log.info(`Error file moved to: ${profile.errorPath}/${fileName}`);
      } catch (moveErr) {
        log.error(`Failed to move error file to ${profile.errorPath}`, moveErr);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Watcher lifecycle
// ---------------------------------------------------------------------------

async function startWatcher(profile: CaptureProfileRecord): Promise<void> {
  // Ensure the watch folder exists
  try {
    await fs.mkdir(profile.folderPath, { recursive: true });
  } catch (err) {
    log.error(`Cannot create/access folder: ${profile.folderPath}`, err);
    return;
  }

  const watcher = chokidar.watch(profile.folderPath, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false, // process existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 200,
    },
    depth: 0, // only watch the top-level directory
  });

  watcher.on("add", (filePath: string) => {
    if (isShuttingDown) return;
    log.info(`${YELLOW}File detected:${RESET} ${path.basename(filePath)}`, {
      folder: profile.folderPath,
    });
    // Queue for processing (fire-and-forget, errors caught internally)
    safeProcessFile(filePath, profile);
  });

  watcher.on("error", (err: unknown) => {
    log.error(`Watcher error for profile "${profile.name}"`, err);
  });

  watchers.set(profile.id, {
    profileId: profile.id,
    profileName: profile.name,
    watcher,
  });

  log.info(
    `${GREEN}Watching:${RESET} ${BOLD}${profile.name}${RESET} -> ${profile.folderPath}`,
    { fileTypes: profile.fileTypes, duplicateAction: profile.duplicateAction }
  );
}

async function stopWatcher(profileId: string): Promise<void> {
  const entry = watchers.get(profileId);
  if (!entry) return;

  await entry.watcher.close();
  watchers.delete(profileId);
  log.info(`Stopped watcher: ${entry.profileName}`);
}

// ---------------------------------------------------------------------------
// Profile refresh loop
// ---------------------------------------------------------------------------

async function refreshProfiles(): Promise<void> {
  log.debug("Refreshing capture profiles from database...");

  try {
    const profiles = await prisma.captureProfile.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        folderPath: true,
        processedPath: true,
        errorPath: true,
        fileTypes: true,
        isActive: true,
        formTemplateId: true,
        department: true,
        classificationNodeId: true,
        metadataMapping: true,
        duplicateAction: true,
        createdById: true,
      },
    });

    const activeIds = new Set(profiles.map((p) => p.id));

    // Stop watchers for profiles that are no longer active
    for (const [id, entry] of watchers.entries()) {
      if (!activeIds.has(id)) {
        log.info(`Profile deactivated: ${entry.profileName} — stopping watcher`);
        await stopWatcher(id);
      }
    }

    // Start watchers for newly active profiles
    for (const profile of profiles) {
      if (!watchers.has(profile.id)) {
        log.info(`New active profile detected: ${profile.name}`);
        await startWatcher(profile as CaptureProfileRecord);
      }
    }
  } catch (err) {
    log.error("Failed to refresh profiles", err);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(""); // newline after ^C
  log.info(`${YELLOW}${BOLD}Shutting down${RESET} (received ${signal})...`);

  // Stop refresh timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // Close all watchers
  const closePromises: Promise<void>[] = [];
  for (const [id] of watchers) {
    closePromises.push(stopWatcher(id));
  }
  await Promise.all(closePromises);

  // Disconnect Prisma
  await prisma.$disconnect();

  log.info(`${GREEN}${BOLD}Capture worker stopped gracefully.${RESET}`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function printBanner(): void {
  console.log("");
  console.log(`${CYAN}${BOLD}  ╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}  ║        EDRMS Capture Worker                     ║${RESET}`);
  console.log(`${CYAN}${BOLD}  ║        Hot Folder Document Ingestion Service     ║${RESET}`);
  console.log(`${CYAN}${BOLD}  ╚══════════════════════════════════════════════════╝${RESET}`);
  console.log("");
  console.log(`  ${DIM}Uploads directory:${RESET}  ${UPLOADS_DIR}`);
  console.log(`  ${DIM}Profile refresh:${RESET}    every ${PROFILE_REFRESH_INTERVAL_MS / 1000}s`);
  console.log(`  ${DIM}File settle delay:${RESET}  ${FILE_SETTLE_DELAY_MS}ms`);
  console.log(`  ${DIM}Started at:${RESET}         ${new Date().toISOString()}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  printBanner();

  // Test database connection
  try {
    await prisma.$connect();
    log.success("Connected to database");
  } catch (err) {
    log.error("Failed to connect to database", err);
    process.exit(1);
  }

  // Ensure uploads directory exists
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  // Initial profile load
  const profiles = await prisma.captureProfile.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      folderPath: true,
      processedPath: true,
      errorPath: true,
      fileTypes: true,
      isActive: true,
      formTemplateId: true,
      department: true,
      classificationNodeId: true,
      metadataMapping: true,
      duplicateAction: true,
      createdById: true,
    },
  });

  if (profiles.length === 0) {
    log.warn("No active capture profiles found. Worker will wait for profiles to be activated.");
  } else {
    log.info(`Found ${BOLD}${profiles.length}${RESET} active capture profile(s)`);
  }

  // Start watchers for each active profile
  for (const profile of profiles) {
    await startWatcher(profile as CaptureProfileRecord);
  }

  // Start periodic profile refresh
  refreshTimer = setInterval(() => {
    if (!isShuttingDown) {
      refreshProfiles();
    }
  }, PROFILE_REFRESH_INTERVAL_MS);

  log.info(`${GREEN}${BOLD}Capture worker is running.${RESET} Press Ctrl+C to stop.`);
}

// Run
main().catch((err) => {
  log.error("Fatal error in capture worker", err);
  process.exit(1);
});
