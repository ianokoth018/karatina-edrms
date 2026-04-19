/**
 * Standalone OCR worker — process OCR jobs from the pg-boss queue.
 *
 * Use this when the capture-worker is not running but you still want
 * OCR to be processed for manually uploaded files.
 *
 * Usage: npx tsx scripts/ocr-worker.ts
 */

import "dotenv/config";
import { startOcrWorker, stopBoss } from "../lib/queue";

async function main() {
  console.log("[ocr-worker] Starting OCR worker...");

  await startOcrWorker();

  console.log("[ocr-worker] OCR worker running. Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    console.log("\n[ocr-worker] Shutting down...");
    await stopBoss();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await stopBoss();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[ocr-worker] Fatal error:", err);
  process.exit(1);
});
