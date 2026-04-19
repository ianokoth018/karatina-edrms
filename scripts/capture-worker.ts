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

import { PrismaClient, Prisma } from "@prisma/client";
import chokidar, { type FSWatcher } from "chokidar";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { parseXmlBuddyFile as sharedParseXmlBuddyFile } from "../lib/xml-buddy";
import { validateMetadata } from "../lib/capture-validator";
import { detectBarcodes } from "../lib/barcode";
import { hasPdfSignatures } from "../lib/pdf-signature";
import { removeBlankPages } from "../lib/pdf-quality";
import { convertToPdfA } from "../lib/pdfa";
import { generateThumbnail } from "../lib/thumbnail";
import { enqueueOcr } from "../lib/queue";
import { fireTriggers } from "../lib/capture-notifications";
import pLimit from "p-limit";

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
  validationRules: unknown;
  duplicateAction: string;
  createdById: string;
  priority: number;
  sourceType: string;
  enableBlankPageRemoval: boolean;
  enablePdfA: boolean;
  pdfALevel: string | null;
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

// Global concurrency limit — caps simultaneous file processing across all profiles
const fileProcessingLimit = pLimit(8);
// Separate lower-limit limiter for OCR (CPU-intensive)
const ocrLimit = pLimit(3);

// ---------------------------------------------------------------------------
// Department code lookup (mirrors lib/departments.ts)
// ---------------------------------------------------------------------------

const DEPT_CODE_MAP: Record<string, string> = {
  "Vice Chancellor's Office": "VC",
  "DVC (Planning, Finance & Administration)": "DVC-PFA",
  "DVC (Academic, Research & Student Affairs)": "DVC-ARSA",
  "Registrar (Planning & Administration)": "RG-PA",
  "Registrar (Academic & Student Affairs)": "RG-ASA",
  "School of Pure and Applied Sciences": "SPAS",
  "School of Business": "SB",
  "School of Education and Social Sciences": "SESS",
  "School of Agriculture and Biotechnology": "SAB",
  "School of Natural Resources and Environmental Studies": "SNRES",
  "School of Nursing and Public Health": "SNPH",
  "ICT Directorate": "ICT",
  "Directorate of Quality Assurance and ISO": "DQAI",
  "Directorate of Research, Innovation and Extension": "DRIE",
  "Directorate of Resource Mobilization": "DRM",
  "Directorate of Open, Distance and E-Learning": "ODEL",
  "Directorate of Career Services and University-Industry Linkage": "DCSL",
  "Directorate of Community Outreach": "DCO",
  "Finance Department": "FIN",
  "Human Resource Department": "HR",
  "Procurement Department": "PROC",
  "Internal Audit": "IA",
  "Legal Office": "LEG",
  "Library Services": "LIB",
  "Registry (Records)": "REG",
  "Admissions Office": "ADM",
  "Estates Department": "EST",
  "Security Services": "SEC",
  "Health Services": "HLS",
  "Planning Office": "PLN",
  "Hostels & Accommodation": "HST",
  Transport: "TRN",
  "Department of Computer Science": "CS",
  "Department of Business Management": "BM",
  "Department of Education": "EDU",
};

function getDeptCode(department: string): string {
  return DEPT_CODE_MAP[department] ?? (department.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "GEN");
}

// ---------------------------------------------------------------------------
// Reference number generation (mirrors lib/reference.ts)
// ---------------------------------------------------------------------------

async function generateReference(prefix: string, department: string): Promise<string> {
  const year = new Date().getFullYear();
  const deptAbbr = getDeptCode(department);
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
 * basename matches the XML's basename AND whose extension is one of the
 * profile's allowed types (excluding xml). Returns the absolute path of the
 * first match, or null if the timeout elapsed.
 */
async function waitForPdfBuddy(
  xmlFilePath: string,
  profile: CaptureProfileRecord,
  maxWaitMs = 5000,
  pollIntervalMs = 500
): Promise<string | null> {
  const dir = path.dirname(xmlFilePath);
  const baseName = path.basename(xmlFilePath, path.extname(xmlFilePath));
  const candidateExts = profile.fileTypes
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
 * Find a sibling document file next to the given XML whose extension is in
 * the profile's allowed types (excluding xml). Synchronous single-shot check
 * (no polling). Returns the absolute path or null.
 */
async function findSiblingDocument(
  xmlFilePath: string,
  profile: CaptureProfileRecord
): Promise<string | null> {
  const dir = path.dirname(xmlFilePath);
  const baseName = path.basename(xmlFilePath, path.extname(xmlFilePath));
  const candidateExts = profile.fileTypes
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

async function parseXmlBuddyFile(
  documentFilePath: string
): Promise<{ found: boolean; metadata: Record<string, string>; xmlPath: string | null }> {
  const result = await sharedParseXmlBuddyFile(documentFilePath);
  if (result.error) {
    log.warn(
      `Failed to parse XML buddy file: ${result.xmlPath} — ${result.error}`
    );
  } else if (result.found && result.xmlPath) {
    log.info(
      `XML buddy file found: ${BLUE}${path.basename(result.xmlPath)}${RESET} — ${result.fields.length} fields extracted`
    );
  }
  return { found: result.found, metadata: result.metadata, xmlPath: result.xmlPath };
}

// ---------------------------------------------------------------------------
// Orphan XML repair — patch documents whose sidecar arrived after the PDF
// ---------------------------------------------------------------------------

/**
 * Handle a standalone XML sidecar whose paired PDF was already captured.
 * Looks for a recent CaptureLog (last 60s) sharing the basename and, if found,
 * merges the XML metadata into the linked Document. If no recent orphan
 * capture exists we silently return so processFile's own XML wait can consume
 * the sidecar when the PDF eventually arrives.
 */
async function handleOrphanXml(
  xmlPath: string,
  profile: CaptureProfileRecord
): Promise<void> {
  const xmlName = path.basename(xmlPath);
  const baseName = path.basename(xmlPath, path.extname(xmlPath));

  // 1. If a sibling document file exists right now, let the PDF's own add
  //    event drive the pairing. Do not delete/move the XML.
  if (profile.formTemplateId) {
    const sibling = await findSiblingDocument(xmlPath, profile);
    if (sibling) {
      log.debug(
        `Standalone XML "${xmlName}" — sibling ${path.basename(sibling)} already present; PDF handler will pair`
      );
      return;
    }
  }

  // 2. Look for a recently captured sibling (PDF, TIFF, etc.) in this profile
  //    — orphan-repair for late-arriving XMLs (unchanged 60s window).
  const cutoff = new Date(Date.now() - 60_000);
  const orphan = await prisma.captureLog.findFirst({
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
    //    mandatory PDF-buddy rule: wait up to 5s for the PDF; if it arrives,
    //    the PDF's own handler takes over. If not, the XML is incomplete —
    //    move to errorPath (or delete) and log FAILED.
    if (profile.formTemplateId) {
      const pdfArrived = await waitForPdfBuddy(xmlPath, profile, 5000);
      if (pdfArrived) {
        log.debug(
          `Standalone XML "${xmlName}" — PDF ${path.basename(pdfArrived)} arrived during wait; PDF handler will pair`
        );
        return;
      }

      // Verify the XML is still present (the PDF handler may have consumed it)
      try {
        await fs.access(xmlPath);
      } catch {
        log.debug(`XML "${xmlName}" already consumed while waiting for PDF`);
        return;
      }

      log.warn(
        `${YELLOW}Incomplete buddy pair${RESET} — XML "${BLUE}${xmlName}${RESET}" arrived without its PDF sidecar`,
        { basename: baseName, reason: "MISSING_PDF_BUDDY" }
      );

      let movedTo: string | null = null;
      if (profile.errorPath) {
        try {
          movedTo = await moveFile(xmlPath, profile.errorPath, xmlName);
        } catch (moveErr) {
          log.error(`Failed to move incomplete XML to errorPath`, moveErr);
        }
      } else {
        try { await fs.unlink(xmlPath); } catch { /* already gone */ }
      }

      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName: xmlName,
          filePath: movedTo ?? xmlPath,
          // See note in processFile: CaptureStatus enum has no FAILED value.
          status: "ERROR",
          errorMessage:
            "Incomplete buddy pair — XML arrived without its PDF sidecar",
          metadata: { reason: "MISSING_PDF_BUDDY", basename: baseName },
          processedAt: new Date(),
        },
      });
      return;
    }

    // Non-casefolder profile — XML is an accident here. Move/delete silently.
    log.debug(
      `Standalone XML "${xmlName}" on non-casefolder profile — moving aside`
    );
    if (profile.errorPath) {
      try { await moveFile(xmlPath, profile.errorPath, xmlName); } catch { /* already gone */ }
    } else {
      try { await fs.unlink(xmlPath); } catch { /* already gone */ }
    }
    return;
  }

  // Parse the XML metadata.
  const parsed = await parseXmlBuddyFile(path.join(path.dirname(xmlPath), `${baseName}.xml`));
  if (!parsed.found) {
    log.warn(`Orphan XML "${xmlName}" could not be parsed; leaving in place`);
    return;
  }

  // Load the existing document and merge metadata.
  const doc = await prisma.document.findUnique({
    where: { id: orphan.documentId },
    select: { id: true, metadata: true },
  });
  if (!doc) {
    log.warn(`Orphan XML "${xmlName}" — linked document ${orphan.documentId} missing`);
    return;
  }

  // Optionally re-map XML raw names via the casefolder template for this doc.
  // The template id is stored in document.metadata.formTemplateId (set at
  // capture time); fall back to the profile's template.
  const remapped: Record<string, string> = {};
  const docMetaInitial = (doc.metadata ?? {}) as Record<string, unknown>;
  const templateId =
    (typeof docMetaInitial.formTemplateId === "string"
      ? (docMetaInitial.formTemplateId as string)
      : null) ?? profile.formTemplateId;
  if (templateId) {
    const template = await prisma.formTemplate.findUnique({
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
  const existingLabels = (existing._fieldLabels as Record<string, string>) ?? {};
  const cleanXml = Object.fromEntries(
    Object.entries(parsed.metadata).filter(([k]) => !k.startsWith("_raw_"))
  );
  const xmlLabels = Object.fromEntries(
    Object.entries(parsed.metadata)
      .filter(([k]) => k.startsWith("_raw_"))
      .map(([k, v]) => [k.replace("_raw_", ""), v])
  );

  const mergedMetadata: Record<string, unknown> = {
    ...existing,
    ...cleanXml,
    ...remapped,
    xmlSource: true,
    _fieldLabels: { ...existingLabels, ...xmlLabels },
  };

  await prisma.document.update({
    where: { id: doc.id },
    // Cast: Prisma's JSON input type doesn't accept arbitrary
    // Record<string, unknown> directly; mergedMetadata is JSON-safe by
    // construction.
    data: { metadata: mergedMetadata as unknown as Prisma.InputJsonValue },
  });

  // Move or delete the XML so we don't re-process it.
  if (profile.processedPath) {
    try {
      await moveFile(xmlPath, profile.processedPath, xmlName);
    } catch { /* already gone */ }
  } else {
    try { await fs.unlink(xmlPath); } catch { /* already gone */ }
  }

  // Traceability log. Note: the CaptureStatus enum does not include a
  // METADATA_PATCHED value and the task forbids schema changes, so we store
  // the sentinel inside metadata.action and use CAPTURED for the row status.
  await prisma.captureLog.create({
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

  log.success(
    `${MAGENTA}Orphan XML patched${RESET} "${BLUE}${xmlName}${RESET}" -> doc ${BOLD}${doc.id}${RESET}`,
    { originLogId: orphan.id }
  );
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

  // 1a. Standalone XML files are handled by the orphan-repair backstop —
  // when a PDF was committed before its sidecar arrived, patch the document
  // metadata now. If no recent orphan capture exists, assume the PDF will
  // arrive shortly and let processFile consume this XML as a buddy.
  if (ext === "xml") {
    await handleOrphanXml(filePath, profile);
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

  // 4. Wait for the XML buddy when the profile expects one. We only wait for
  // casefolder-linked profiles; plain filename-mapping profiles skip the wait.
  // This must happen BEFORE the hash / dedup check so a late-arriving XML
  // doesn't cause us to process the same basename twice.
  //
  // NEW (mandatory buddy-pair rule): for casefolder-linked profiles the PDF
  // and XML are a REQUIRED pair. If the XML never arrives, we must NOT file
  // the PDF with filename-only metadata — move to errorPath (or delete) and
  // log a FAILED CaptureLog entry with reason MISSING_XML_BUDDY.
  const expectsXml = !!profile.formTemplateId;
  if (expectsXml) {
    const found = await waitForXmlBuddy(filePath, 5000);
    log.debug(`XML buddy wait for ${fileName}: ${found ? "found" : "timed out"}`);
    if (!found) {
      const baseName = path.basename(fileName, path.extname(fileName));
      log.warn(
        `${YELLOW}Incomplete buddy pair${RESET} — PDF "${BLUE}${fileName}${RESET}" arrived without its XML sidecar`,
        { basename: baseName, reason: "MISSING_XML_BUDDY" }
      );

      let movedTo: string | null = null;
      if (profile.errorPath) {
        try {
          movedTo = await moveFile(filePath, profile.errorPath, fileName);
        } catch (moveErr) {
          log.error(`Failed to move incomplete PDF to errorPath`, moveErr);
        }
      } else {
        try { await fs.unlink(filePath); } catch { /* already gone */ }
      }

      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath: movedTo ?? filePath,
          // CaptureStatus enum has no FAILED value and schema changes are
          // forbidden; ERROR is the existing semantic for a failure that
          // yields no Document. Discriminator lives in metadata.reason.
          status: "ERROR",
          errorMessage:
            "Incomplete buddy pair — PDF arrived without its XML sidecar",
          metadata: { reason: "MISSING_XML_BUDDY", basename: baseName },
          processedAt: new Date(),
        },
      });
      return;
    }
  }

  // 5. Extract metadata — XML buddy file takes priority, then filename pattern.
  // Done before hashing/dedup so the commit step has full metadata knowledge.
  const metadataMapping = (profile.metadataMapping ?? {}) as Record<string, unknown>;
  const filenameMeta = extractMetadata(fileName, metadataMapping);

  // Check for XML buddy file (scanner sidecar)
  const xmlResult = await parseXmlBuddyFile(filePath);
  const extractedMeta: Record<string, string> = {
    ...filenameMeta,      // filename pattern fields as baseline
    ...xmlResult.metadata, // XML fields override filename fields
  };

  // 5b. Per-field validation. If any rule fails, create a CaptureException
  // (status=PENDING) and log VALIDATION_FAILED. The file is left in place
  // (not moved to errorPath) so the exception-review UI can inspect and
  // re-trigger capture once metadata is corrected.
  if (profile.validationRules) {
    const validation = await validateMetadata(
      profile.validationRules,
      extractedMeta,
      prisma
    );
    if (!validation.valid) {
      await prisma.captureException.create({
        data: {
          profileId: profile.id,
          filePath,
          extractedMetadata: extractedMeta,
          errors: validation.errors as unknown as Prisma.InputJsonValue,
          status: "PENDING",
        },
      });
      await prisma.captureLog.create({
        data: {
          profileId: profile.id,
          fileName,
          filePath,
          status: "VALIDATION_FAILED",
          errorMessage: `Metadata validation failed (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"})`,
          metadata: {
            extractedMetadata: extractedMeta,
            validationErrors: validation.errors,
          } as unknown as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      log.warn(
        `${YELLOW}Validation failed${RESET} — "${BLUE}${fileName}${RESET}" left in place for review`,
        { errors: validation.errors.map((e) => `${e.field}:${e.reason}`) }
      );
      return;
    }
  }

  // 6. Get file stats
  const stats = await fs.stat(filePath);

  // 7. Compute SHA-256 hash
  const fileHash = await computeFileHash(filePath);
  log.debug(`Hash for "${fileName}": ${fileHash}`);

  // 8. Check for duplicates in capture_logs
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

  // 9. Clean up the buddy XML file if found (deferred until after dedup so a
  // skipped duplicate does not consume its sidecar).
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

  // 10b. Pre-encryption PDF processing (blank page removal + PDF/A conversion)
  // These modify the stored copy at destPath before it is encrypted.
  if (ext === "pdf") {
    if (profile.enableBlankPageRemoval) {
      try {
        const tmpPath = destPath + ".noblanks.pdf";
        const result = await removeBlankPages(destPath, tmpPath);
        if (result.removedPages.length > 0) {
          await fs.rename(tmpPath, destPath);
          log.info(
            `Removed ${result.removedPages.length} blank page(s) from "${fileName}"`,
            { removed: result.removedPages, total: result.totalPages }
          );
        } else {
          await fs.unlink(tmpPath).catch(() => null);
        }
      } catch (blankErr) {
        log.warn(`Blank page removal failed (non-fatal)`, blankErr as Record<string, unknown>);
      }
    }

    if (profile.enablePdfA) {
      try {
        const pdfaPath = destPath + ".pdfa.pdf";
        const result = await convertToPdfA(destPath, pdfaPath, (profile.pdfALevel || "2b") as "1b" | "2b" | "3b");
        if (result) {
          await fs.rename(pdfaPath, destPath);
          log.info(`Converted "${fileName}" to PDF/A-${profile.pdfALevel || "2b"}`);
        }
      } catch (pdfaErr) {
        log.warn(`PDF/A conversion failed (non-fatal)`, pdfaErr as Record<string, unknown>);
      }
    }
  }

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

  // 11b. Phase 2 enrichment: barcode, signature, thumbnail, OCR, triggers
  const enrichmentMeta: Record<string, unknown> = {};

  if (ext === "pdf" || ext === "tiff") {
    try {
      const barcodes = await detectBarcodes(filePath);
      if (barcodes.length > 0) {
        enrichmentMeta.barcodes = barcodes.map((b) => ({ type: b.type, data: b.data, confidence: b.confidence }));
        log.info("Barcode(s) found: " + barcodes.map((b) => b.data).join(", "));
      }
    } catch { /* non-fatal */ }
  }

  if (ext === "pdf") {
    try {
      enrichmentMeta.hasPdfSignatures = await hasPdfSignatures(filePath);
    } catch { /* non-fatal */ }
  }

  if (ext === "pdf") {
    try {
      const thumbPath = await generateThumbnail(filePath, uploadDir, { page: 1, dpi: 150 });
      enrichmentMeta.thumbnailPath = thumbPath;
      log.debug("Thumbnail: " + thumbPath);
    } catch { /* non-fatal */ }
  }

  if (Object.keys(enrichmentMeta).length > 0) {
    try {
      await prisma.document.update({
        where: { id: document.id },
        data: { metadata: { ...(document.metadata as object), ...enrichmentMeta } as import("@prisma/client").Prisma.InputJsonValue },
      });
    } catch { /* non-fatal */ }
  }

  // Enqueue OCR with profile priority
  const fileRecord = await prisma.documentFile.findFirst({
    where: { documentId: document.id },
    select: { id: true },
  });
  if (fileRecord) {
    await enqueueOcr(fileRecord.id, { priority: profile.priority ?? 0 });
    log.debug("OCR enqueued for fileId: " + fileRecord.id + " (priority: " + (profile.priority ?? 0) + ")");
  }

  // Fire capture notification triggers
  try {
    await fireTriggers(prisma, {
      profileId: profile.id,
      documentType: document.documentType ?? null,
      registrationNumber: (extractedMeta as Record<string, string>).registrationNumber ?? null,
      documentId: document.id,
      fileId: fileRecord?.id ?? null,
      fileName,
      metadata: enrichmentMeta,
    });
  } catch { /* non-fatal */ }

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
      queued: fileProcessingLimit.pendingCount,
      active: fileProcessingLimit.activeCount,
    });
    fileProcessingLimit(() => safeProcessFile(filePath, profile));
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
        validationRules: true,
        duplicateAction: true,
        createdById: true,
        priority: true,
        sourceType: true,
        enableBlankPageRemoval: true,
        enablePdfA: true,
        pdfALevel: true,
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

  // Stop pg-boss gracefully
  try {
    const { stopBoss } = await import("../lib/queue");
    await stopBoss();
  } catch { /* ignore */ }

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

  // Start the pg-boss OCR worker in this process
  const { startOcrWorker, stopBoss } = await import("../lib/queue");
  await startOcrWorker();

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
      priority: true,
      sourceType: true,
      enableBlankPageRemoval: true,
      enablePdfA: true,
      pdfALevel: true,
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
