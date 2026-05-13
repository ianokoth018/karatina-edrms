/**
 * Re-extract per-word OCR bounding boxes for every DocumentFile that
 * already has `ocrText` but no OcrWord rows. Idempotent — runs in batches
 * and skips files that already have words extracted.
 *
 * Usage: npx tsx scripts/reextract-ocr-words.ts
 */
import "dotenv/config";
import path from "path";
import { db } from "../lib/db";
import { extractOcrWords } from "../lib/ocr-bbox";

async function main() {
  const candidates = await db.documentFile.findMany({
    where: {
      ocrText: { not: null },
      ocrWords: { none: {} },
      mimeType: { startsWith: "application/pdf" },
    },
    select: { id: true, storagePath: true, fileName: true },
  });

  console.log(`[reextract-ocr-words] ${candidates.length} files to process`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const f of candidates) {
    try {
      const abs = path.join(process.cwd(), f.storagePath);
      const pages = await extractOcrWords(abs);
      const flat = pages.flatMap((p) =>
        p.words.map((w) => ({
          fileId: f.id,
          page: w.page,
          x: w.x,
          y: w.y,
          width: w.width,
          height: w.height,
          text: w.text,
          confidence: w.confidence,
        })),
      );
      if (flat.length === 0) {
        skipped++;
        console.log(`[reextract-ocr-words] skip (no words) ${f.fileName}`);
        continue;
      }
      // Chunk inserts to keep parameter count under PG limits.
      const CHUNK = 1000;
      for (let i = 0; i < flat.length; i += CHUNK) {
        await db.ocrWord.createMany({
          data: flat.slice(i, i + CHUNK),
          skipDuplicates: true,
        });
      }
      ok++;
      console.log(`[reextract-ocr-words] ok ${f.fileName} (${flat.length} words)`);
    } catch (err) {
      failed++;
      console.error(`[reextract-ocr-words] failed ${f.fileName}:`, err);
    }
  }

  console.log(
    `[reextract-ocr-words] done — ok=${ok} skipped=${skipped} failed=${failed}`,
  );
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
