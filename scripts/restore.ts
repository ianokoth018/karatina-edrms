/**
 * Restore CLI.
 *
 *   npx tsx scripts/restore.ts <manifest.json> --yes
 *   npx tsx scripts/restore.ts ./backups/manifest-2026-05-13T02-00-00.json --yes
 *
 * Steps:
 *   1. Reads the manifest, verifies sha256 of both artefacts.
 *   2. Refuses to proceed without --yes (the operation is destructive:
 *      `pg_restore --clean --if-exists` drops every object in the dump).
 *   3. Runs pg_restore against DATABASE_URL.
 *   4. Extracts the uploads tarball back into ./uploads.
 *   5. Audits via writeAudit (action: db.restore).
 */

import path from "path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runRestore } from "@/lib/backup";
import { writeAudit } from "@/lib/audit";

function parseArgs(argv: string[]): {
  manifest?: string;
  yes: boolean;
  help: boolean;
} {
  const out = { yes: false, help: false } as {
    manifest?: string;
    yes: boolean;
    help: boolean;
  };
  for (const a of argv.slice(2)) {
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!out.manifest) out.manifest = a;
  }
  return out;
}

function usage(): void {
  console.log(`Usage: npx tsx scripts/restore.ts <manifest.json> --yes

Restores a Karatina EDRMS backup. DESTRUCTIVE — the existing database
contents are dropped and replaced by the dump, and the uploads/ tree is
overwritten by the tarball contents.

Flags:
  --yes, -y    Required. Confirms you accept the destructive nature.
  --help, -h   Show this message.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help || !args.manifest) {
    usage();
    process.exit(args.help ? 0 : 2);
  }

  if (!args.yes) {
    console.error(
      "Refusing to run without --yes. This is a destructive operation."
    );
    process.exit(2);
  }

  const manifestPath = path.resolve(args.manifest!);
  logger.info("restore: starting", { manifestPath });

  try {
    const manifest = await runRestore(manifestPath);
    logger.info("restore: complete", {
      manifestId: manifest.id,
      timestamp: manifest.timestamp,
    });
    await writeAudit({
      action: "db.restore",
      resourceType: "system",
      resourceId: manifest.id,
      metadata: {
        manifestPath,
        manifestId: manifest.id,
        backupTimestamp: manifest.timestamp,
        dbDumpPath: manifest.dbDumpPath,
        uploadsPath: manifest.uploadsPath,
        dbSize: manifest.dbSize,
        uploadsSize: manifest.uploadsSize,
        includeArchive: manifest.includeArchive,
      },
    });
    console.log("\nRestore complete.");
    console.log(`  manifest:  ${manifestPath}`);
    console.log(`  taken at:  ${manifest.timestamp}`);
  } catch (err) {
    logger.error("restore: failed", err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  logger.error("restore: fatal", err);
  process.exit(1);
});
