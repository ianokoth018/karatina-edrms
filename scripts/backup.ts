/**
 * Manual backup CLI.
 *
 *   npx tsx scripts/backup.ts
 *   BACKUP_DIR=/srv/edrms-backups npx tsx scripts/backup.ts
 *   INCLUDE_ARCHIVE=1            npx tsx scripts/backup.ts
 *
 * Produces three files under BACKUP_DIR (default ./backups):
 *   - db-<stamp>.dump            (pg_dump custom format)
 *   - uploads-<stamp>.tar.gz     (encrypted file bytes)
 *   - manifest-<stamp>.json      (sha256 checksums + sizes)
 *
 * Also writes a BackupLog row (type=manual) so the run shows up in the
 * admin UI alongside scheduled runs.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runBackup, resolveBackupDir } from "@/lib/backup";

async function main(): Promise<void> {
  const start = Date.now();
  const dir = resolveBackupDir();
  logger.info("backup: starting", { backupDir: dir });

  try {
    const { manifest, manifestPath } = await runBackup({ type: "manual" });
    const durationMs = Date.now() - start;

    await db.backupLog.create({
      data: {
        type: "manual",
        dbDumpPath: manifest.dbDumpPath,
        uploadsPath: manifest.uploadsPath,
        dbBytes: BigInt(manifest.dbSize),
        uploadsBytes: BigInt(manifest.uploadsSize),
        durationMs,
        status: "SUCCESS",
      },
    });

    logger.info("backup: complete", {
      manifestPath,
      dbSize: manifest.dbSize,
      uploadsSize: manifest.uploadsSize,
      durationMs,
    });
    console.log(`\nBackup complete.`);
    console.log(`  manifest: ${manifestPath}`);
    console.log(`  db dump : ${manifest.dbDumpPath} (${manifest.dbSize} bytes)`);
    console.log(`  uploads : ${manifest.uploadsPath} (${manifest.uploadsSize} bytes)`);
    console.log(`  sha256.db      ${manifest.checksums.db}`);
    console.log(`  sha256.uploads ${manifest.checksums.uploads}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logger.error("backup: failed", err, { durationMs });
    await db.backupLog
      .create({
        data: {
          type: "manual",
          durationMs,
          status: "FAILED",
          error: message,
        },
      })
      .catch((logErr) =>
        logger.error("backup: also failed to write BackupLog", logErr)
      );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  logger.error("backup: fatal", err);
  process.exit(1);
});
