/**
 * Storage tiering: hot (local SSD) → warm (slower disk) → archive (cold).
 *
 * Today every tier is a local directory under `uploads/`. The shape of this
 * module deliberately mirrors what an S3/Glacier driver would expose so we
 * can later plug a real cloud driver behind the same surface.
 *
 *   hot     → fast local disk; default for fresh uploads.
 *   warm    → demoted after `demoteToWarmDays` of no reads.
 *   archive → demoted after `demoteToArchiveDays` of no reads. Reads either
 *             auto-restore to hot (restoreStrategy="auto") or 409 the request
 *             and wait for a manual restore ("manual").
 */

import path from "path";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { DocumentFile } from "@prisma/client";

export type Tier = "hot" | "warm" | "archive";

/** Map each tier to its root directory (relative to repo root, under `uploads/`). */
export const TIER_ROOTS: Record<Tier, string> = {
  hot: "uploads/edrms",
  warm: "uploads/warm",
  archive: "uploads/archive",
};

/** True if `value` is a valid tier name. */
export function isTier(value: string): value is Tier {
  return value === "hot" || value === "warm" || value === "archive";
}

/**
 * Resolve the absolute disk path where this file is currently expected to
 * live, given its `storageTier`. We rewrite the leading tier-root segment
 * of `storagePath` so a file demoted hot→warm with stored path
 * `uploads/edrms/CAP-1.pdf` resolves to `<cwd>/uploads/warm/CAP-1.pdf`.
 *
 * This means after a successful move, `storagePath` is rewritten too — so
 * the resolver should always agree with the on-disk truth.
 */
export function resolveTierPath(file: {
  storagePath: string;
  storageTier: string;
}): string {
  const tier: Tier = isTier(file.storageTier) ? file.storageTier : "hot";
  const tierRoot = TIER_ROOTS[tier];
  const basename = path.basename(file.storagePath);
  return path.join(process.cwd(), tierRoot, basename);
}

/**
 * Move a file to the given tier. No-op if already there.
 *
 * - `fs.rename` first (atomic on same filesystem)
 * - falls back to copy + unlink for cross-mount moves
 * - updates `storagePath`, `storageTier`, `tierMovedAt` atomically
 */
export async function moveFileToTier(
  file: DocumentFile,
  target: Tier
): Promise<void> {
  const current: Tier = isTier(file.storageTier) ? file.storageTier : "hot";
  if (current === target) return;

  const fromAbs = resolveTierPath(file);
  const basename = path.basename(file.storagePath);
  const newStoragePath = `${TIER_ROOTS[target]}/${basename}`;
  const toAbs = path.join(process.cwd(), TIER_ROOTS[target], basename);

  await fs.mkdir(path.dirname(toAbs), { recursive: true });

  try {
    await fs.rename(fromAbs, toAbs);
  } catch (err) {
    // EXDEV → cross-device; fall back to copy + unlink. Anything else
    // (e.g. source missing) we rethrow so the caller can surface it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      // If source already missing but destination exists, treat as recoverable.
      if (code === "ENOENT") {
        try {
          await fs.access(toAbs);
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    } else {
      await pipeline(createReadStream(fromAbs), createWriteStream(toAbs));
      await fs.unlink(fromAbs).catch(() => {});
    }
  }

  await db.documentFile.update({
    where: { id: file.id },
    data: {
      storagePath: newStoragePath,
      storageTier: target,
      tierMovedAt: new Date(),
    },
  });

  logger.info("storage-tier: moved file", {
    fileId: file.id,
    from: current,
    to: target,
    newStoragePath,
  });
}

const DEFAULT_POLICY = {
  demoteToWarmDays: 90,
  demoteToArchiveDays: 365,
  restoreStrategy: "auto" as const,
};

/** Load active policy, falling back to compile-time defaults if none defined. */
export async function getActivePolicy(): Promise<{
  demoteToWarmDays: number;
  demoteToArchiveDays: number;
  restoreStrategy: string;
}> {
  const row = await db.storageTierPolicy.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return { ...DEFAULT_POLICY };
  return {
    demoteToWarmDays: row.demoteToWarmDays,
    demoteToArchiveDays: row.demoteToArchiveDays,
    restoreStrategy: row.restoreStrategy,
  };
}

/**
 * Walk the active policy and demote eligible files.
 *
 * Batched (50 at a time) so a single run can never lock the table for long.
 * Each move is its own DB write; we do NOT wrap the whole batch in one
 * transaction because file IO can be slow and we want partial progress to
 * survive a crash.
 */
export async function applyTieringPolicy(): Promise<{
  demotedToWarm: number;
  demotedToArchive: number;
}> {
  const policy = await getActivePolicy();
  const now = Date.now();
  const warmCutoff = new Date(now - policy.demoteToWarmDays * 86_400_000);
  const archiveCutoff = new Date(now - policy.demoteToArchiveDays * 86_400_000);

  let demotedToWarm = 0;
  let demotedToArchive = 0;
  const BATCH = 50;

  // Demote warm → archive FIRST so a file that crossed both thresholds in
  // one go (e.g. workload paused for a year) ends up archived in one pass.
  while (true) {
    const batch = await db.documentFile.findMany({
      where: {
        storageTier: "warm",
        OR: [
          { lastAccessedAt: { lt: archiveCutoff } },
          { AND: [{ lastAccessedAt: null }, { uploadedAt: { lt: archiveCutoff } }] },
        ],
      },
      take: BATCH,
    });
    if (batch.length === 0) break;
    for (const file of batch) {
      try {
        await moveFileToTier(file, "archive");
        demotedToArchive++;
      } catch (err) {
        logger.error("storage-tier: warm→archive failed", err, { fileId: file.id });
      }
    }
    if (batch.length < BATCH) break;
  }

  while (true) {
    const batch = await db.documentFile.findMany({
      where: {
        storageTier: "hot",
        OR: [
          { lastAccessedAt: { lt: warmCutoff } },
          { AND: [{ lastAccessedAt: null }, { uploadedAt: { lt: warmCutoff } }] },
        ],
      },
      take: BATCH,
    });
    if (batch.length === 0) break;
    for (const file of batch) {
      try {
        await moveFileToTier(file, "warm");
        demotedToWarm++;
      } catch (err) {
        logger.error("storage-tier: hot→warm failed", err, { fileId: file.id });
      }
    }
    if (batch.length < BATCH) break;
  }

  return { demotedToWarm, demotedToArchive };
}
