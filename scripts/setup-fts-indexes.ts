// Create Postgres full-text-search indexes used by the search API.
// Idempotent (every CREATE uses IF NOT EXISTS). Run once after pulling
// the modern-search work.
//
//   npx tsx scripts/setup-fts-indexes.ts

import { db } from "@/lib/db";

async function main() {
  console.log("Creating FTS indexes…");

  // Documents — title + description + referenceNumber + documentType
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_documents_fts
    ON documents
    USING GIN (
      to_tsvector(
        'english',
        coalesce(title, '') || ' ' ||
        coalesce(description, '') || ' ' ||
        coalesce("referenceNumber", '') || ' ' ||
        coalesce("documentType", '')
      )
    )
  `);
  console.log("  ✓ idx_documents_fts");

  // Document files — OCR text. This is the big one; OCR can be hundreds
  // of pages per file so the index pays for itself quickly.
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_document_files_ocr_fts
    ON document_files
    USING GIN (to_tsvector('english', coalesce("ocrText", '')))
  `);
  console.log("  ✓ idx_document_files_ocr_fts");

  // Memo drafts / workflow instance subjects — useful for memo search.
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_workflow_instances_fts
    ON workflow_instances
    USING GIN (
      to_tsvector('english',
        coalesce(subject, '') || ' ' ||
        coalesce("referenceNumber", '')
      )
    )
  `);
  console.log("  ✓ idx_workflow_instances_fts");

  // Correspondence — subject + reference number. Table name keeps the
  // model's PascalCase since the schema has no @@map for it.
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_correspondence_fts
    ON "Correspondence"
    USING GIN (
      to_tsvector('english',
        coalesce(subject, '') || ' ' ||
        coalesce("referenceNumber", '')
      )
    )
  `);
  console.log("  ✓ idx_correspondence_fts");

  // Trigram extension + indexes for fuzzy "contains" fallback when the
  // user types a substring that tsquery alone wouldn't catch (e.g. an ID).
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  console.log("  ✓ pg_trgm extension");

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
    ON documents USING GIN (title gin_trgm_ops)
  `);
  console.log("  ✓ idx_documents_title_trgm");

  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_documents_ref_trgm
    ON documents USING GIN ("referenceNumber" gin_trgm_ops)
  `);
  console.log("  ✓ idx_documents_ref_trgm");

  console.log("Done.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
