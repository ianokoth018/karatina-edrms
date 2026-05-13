/**
 * Bulk migration import — walks a server-side directory tree and ingests
 * every file as a Document + DocumentFile. Mirrors the canonical encrypted
 * ingestion path used by /api/capture/ingest:
 *
 *   - bytes are written to uploads/edrms/bulk-<jobId>/<sha256>.bin
 *   - encrypted in place with AES-256-GCM via lib/encryption.ts
 *   - dedup on sha256(contentHash) — repeat files mark the item SKIPPED
 *     with the *existing* documentId
 *   - every successful ingest is audited as `document.bulk_imported`
 *
 * v1 only supports local filesystem sources. To add S3 / SMB / SFTP later,
 * extend `enumerateDirectory` with an alternative implementation guarded
 * on the job.sourcePath protocol prefix; the rest of `runImportJob` is
 * source-agnostic once it gets back `{ relPath, bytes }` tuples.
 */

import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { encryptFile } from "@/lib/encryption";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateReference } from "@/lib/reference";
import { getDepartmentCode } from "@/lib/departments";

/** Walker rules — applied uniformly across the tree. */
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB per file
const SYSTEM_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".Trash",
  ".Trashes",
  "__MACOSX",
]);
const SYSTEM_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "ehthumbs.db",
  "Icon\r",
]);

/** Counter-flush cadence — minimise DB writes on large jobs. */
const COUNTER_FLUSH_EVERY = 50;

/** Hard cap on per-job runtime. The worker aborts the job after this. */
const MAX_JOB_RUNTIME_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Recursively enumerate every regular file under `sourcePath`.
 *
 * Skips:
 *   - dotfiles and dot-directories (hidden by convention)
 *   - well-known system directories (.git, $RECYCLE.BIN, …)
 *   - well-known system files (.DS_Store, Thumbs.db, …)
 *   - symlinks (we walk lstat to avoid following loops)
 *   - files larger than 500 MB (logged + skipped)
 *
 * Yields `{ relPath, bytes }` relative to `sourcePath`.
 */
export async function* enumerateDirectory(
  sourcePath: string,
): AsyncIterable<{ relPath: string; bytes: number }> {
  const root = path.resolve(sourcePath);

  async function* walk(dir: string): AsyncIterable<{ relPath: string; bytes: number }> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn("bulk-import: cannot read directory", {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (SYSTEM_DIRS.has(name)) continue;

      const fullPath = path.join(dir, name);

      // Skip symlinks outright — avoids loops and out-of-tree escapes.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        yield* walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (SYSTEM_FILES.has(name)) continue;

      let stat: import("fs").Stats;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) {
        logger.warn("bulk-import: skipping oversize file", {
          file: fullPath,
          sizeBytes: stat.size,
          cap: MAX_FILE_BYTES,
        });
        continue;
      }

      const relPath = path.relative(root, fullPath);
      yield { relPath, bytes: stat.size };
    }
  }

  yield* walk(root);
}

/** Minimal extension → MIME map. Falls back to application/octet-stream. */
function mimeFromExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".doc": return "application/msword";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls": return "application/vnd.ms-excel";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".ppt": return "application/vnd.ms-powerpoint";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".txt": return "text/plain";
    case ".csv": return "text/csv";
    case ".html":
    case ".htm": return "text/html";
    case ".xml": return "application/xml";
    case ".json": return "application/json";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".webp": return "image/webp";
    case ".eml": return "message/rfc822";
    case ".msg": return "application/vnd.ms-outlook";
    case ".zip": return "application/zip";
    case ".rtf": return "application/rtf";
    default: return "application/octet-stream";
  }
}

/** Parse the comma-separated tags column into a deduplicated list. */
function parseTags(tagsCsv: string | null): string[] {
  if (!tagsCsv) return [];
  return Array.from(
    new Set(
      tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

interface JobCounters {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  /** Pending delta since the last DB flush. */
  pendingFlush: number;
}

async function flushCounters(
  jobId: string,
  counters: JobCounters,
  force = false,
): Promise<void> {
  if (!force && counters.pendingFlush < COUNTER_FLUSH_EVERY) return;
  try {
    await db.bulkImportJob.update({
      where: { id: jobId },
      data: {
        processedFiles: counters.processed,
        skippedFiles: counters.skipped,
        failedFiles: counters.failed,
        totalFiles: counters.total,
      },
    });
    counters.pendingFlush = 0;
  } catch (err) {
    logger.warn("bulk-import: counter flush failed", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run a single bulk-import job to completion. Throws on unrecoverable
 * errors (worker catches and marks FAILED). Idempotent per-file via the
 * dedup-on-contentHash check.
 */
export async function runImportJob(jobId: string): Promise<void> {
  const job = await db.bulkImportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`bulk-import: job ${jobId} not found`);
  if (job.status !== "PENDING" && job.status !== "RUNNING") {
    logger.info("bulk-import: job not runnable, skipping", {
      jobId,
      status: job.status,
    });
    return;
  }

  const startedAt = new Date();
  await db.bulkImportJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt },
  });

  const tags = parseTags(job.tagsCsv);
  const department = (job.department ?? "GENERAL").trim() || "GENERAL";
  const deptAbbr = getDepartmentCode(department);
  const documentType = job.documentType || "OTHER";
  const uploadDir = path.join(process.cwd(), "uploads", "edrms", `bulk-${jobId}`);
  await fs.mkdir(uploadDir, { recursive: true });

  const counters: JobCounters = {
    processed: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    pendingFlush: 0,
  };

  const deadline = startedAt.getTime() + MAX_JOB_RUNTIME_MS;
  let aborted = false;

  for await (const entry of enumerateDirectory(job.sourcePath)) {
    if (Date.now() > deadline) {
      logger.error("bulk-import: job exceeded 24h cap, aborting", { jobId });
      aborted = true;
      break;
    }

    // Per-tick cancellation check — cheap enough at 50-item cadence.
    if (counters.total % COUNTER_FLUSH_EVERY === 0) {
      const fresh = await db.bulkImportJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (fresh?.status === "CANCELLED") {
        logger.info("bulk-import: job cancelled mid-run", { jobId });
        aborted = true;
        break;
      }
    }

    counters.total += 1;
    counters.pendingFlush += 1;

    const item = await db.bulkImportItem.create({
      data: {
        jobId,
        sourcePath: entry.relPath,
        bytes: BigInt(entry.bytes),
        status: "PENDING",
      },
    });

    const absSource = path.join(path.resolve(job.sourcePath), entry.relPath);
    try {
      const bytes = await fs.readFile(absSource);
      const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");

      // Dedup — if a document with the same contentHash exists, skip and
      // point the BulkImportItem at the existing doc.
      const existing = await db.document.findFirst({
        where: { contentHash },
        select: { id: true },
      });

      if (existing) {
        await db.bulkImportItem.update({
          where: { id: item.id },
          data: { status: "SKIPPED", documentId: existing.id },
        });
        counters.skipped += 1;
        await flushCounters(jobId, counters);
        continue;
      }

      const fileName = path.basename(entry.relPath);
      const mimeType = mimeFromExt(fileName);
      const storageFileName = `${contentHash}.bin`;
      const destPath = path.join(uploadDir, storageFileName);
      await fs.writeFile(destPath, bytes);

      let encryptionIv: string | null = null;
      let encryptionTag: string | null = null;
      try {
        const enc = await encryptFile(destPath);
        encryptionIv = enc.iv;
        encryptionTag = enc.tag;
      } catch {
        // Encryption key not configured — store unencrypted (matches
        // capture-ingest behaviour). Will be picked up if the key is
        // added later via a re-encrypt sweep.
      }

      const storagePath = `uploads/edrms/bulk-${jobId}/${storageFileName}`;
      const referenceNumber = await generateReference("DOC", deptAbbr);
      const title = fileName.length > 200 ? fileName.slice(0, 200) : fileName;

      const document = await db.document.create({
        data: {
          referenceNumber,
          title,
          description: `Imported from ${entry.relPath}`,
          documentType,
          department,
          createdById: job.createdById,
          sourceSystem: "BULK_IMPORT",
          sourceId: `${jobId}:${entry.relPath}`,
          contentHash,
          metadata: {
            bulkImportJobId: jobId,
            originalRelativePath: entry.relPath,
          } as unknown as Record<string, never>,
          files: {
            create: {
              storagePath,
              fileName,
              mimeType,
              sizeBytes: BigInt(bytes.length),
              ocrStatus: "PENDING",
              encryptionIv,
              encryptionTag,
            },
          },
          ...(tags.length > 0
            ? {
                tags: {
                  createMany: {
                    data: tags.map((tag) => ({ tag })),
                  },
                },
              }
            : {}),
        },
        select: { id: true, referenceNumber: true },
      });

      await db.bulkImportItem.update({
        where: { id: item.id },
        data: { status: "INGESTED", documentId: document.id },
      });

      await writeAudit({
        userId: job.createdById,
        action: "document.bulk_imported",
        resourceType: "Document",
        resourceId: document.id,
        metadata: {
          bulkImportJobId: jobId,
          bulkImportItemId: item.id,
          referenceNumber: document.referenceNumber,
          sourceRelPath: entry.relPath,
          sizeBytes: bytes.length,
          contentHash,
        },
      });

      counters.processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("bulk-import: item failed", err, {
        jobId,
        itemId: item.id,
        relPath: entry.relPath,
      });
      try {
        await db.bulkImportItem.update({
          where: { id: item.id },
          data: { status: "FAILED", error: message.slice(0, 1000) },
        });
      } catch {
        /* swallow — counters still reflect failure */
      }
      counters.failed += 1;
    }

    await flushCounters(jobId, counters);
  }

  await flushCounters(jobId, counters, true);

  const finishedAt = new Date();
  const finalStatus = aborted
    ? counters.failed === 0 && Date.now() > deadline
      ? "FAILED"
      : "CANCELLED"
    : "COMPLETED";

  await db.bulkImportJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      finishedAt,
      ...(aborted && Date.now() > deadline
        ? { error: "Job exceeded 24h runtime cap" }
        : {}),
    },
  });

  logger.info("bulk-import: job finished", {
    jobId,
    status: finalStatus,
    processed: counters.processed,
    skipped: counters.skipped,
    failed: counters.failed,
    total: counters.total,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });
}
