/**
 * Email Ingest Worker — Rule-driven inbound email auto-ingest.
 *
 * Distinct from the older email-capture-worker.ts which drops PDF
 * attachments into hot folders for the main capture worker. This worker
 * persists every matching message directly as a Document (one per email)
 * with attachments as DocumentFiles, tagged and routed to the configured
 * department.
 *
 * Loop: every 60 s, load all active EmailIngestRules and process each in
 * sequence (no parallelism — IMAP servers don't love it).
 *
 * Usage:
 *   npx tsx scripts/email-ingest-worker.ts
 */

import { PrismaClient } from "@prisma/client";
import { runEmailIngestRule } from "../lib/email-ingest";

const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 60_000;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(
  level: "info" | "warn" | "error",
  msg: string,
  ctx?: Record<string, unknown>
) {
  const prefix = {
    info: `${GREEN}INFO${RESET}`,
    warn: `${YELLOW}WARN${RESET}`,
    error: `${RED}ERROR${RESET}`,
  }[level];
  const ts = new Date().toISOString();
  console.log(`${ts} ${prefix}  ${msg}`, ctx ? JSON.stringify(ctx) : "");
}

async function tick() {
  const rules = await prisma.emailIngestRule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (rules.length === 0) {
    log("info", "No active EmailIngestRules");
    return;
  }

  log("info", `Polling ${rules.length} rule(s)`);

  for (const rule of rules) {
    log("info", `Rule "${rule.name}" — ${rule.imapUser}@${rule.imapHost}:${rule.imapPort}/${rule.mailbox}`);
    try {
      const result = await runEmailIngestRule(rule);
      await prisma.emailIngestRule.update({
        where: { id: rule.id },
        data: {
          lastPolledAt: new Date(),
          lastError: result.errors.length ? result.errors.join(" | ").slice(0, 2000) : null,
        },
      });
      if (result.errors.length) {
        log("warn", `Rule "${rule.name}" finished with errors`, {
          processed: result.processed,
          errors: result.errors.length,
        });
      } else {
        log("info", `Rule "${rule.name}" processed ${result.processed} message(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Rule "${rule.name}" crashed`, { err: msg });
      await prisma.emailIngestRule
        .update({
          where: { id: rule.id },
          data: { lastPolledAt: new Date(), lastError: msg.slice(0, 2000) },
        })
        .catch(() => null);
    }
  }
}

async function main() {
  log("info", `${BOLD}Email Ingest Worker${RESET} starting (poll interval ${POLL_INTERVAL_MS / 1000}s)`);

  await tick().catch((err) => log("error", "Initial tick failed", { err: String(err) }));

  const timer = setInterval(() => {
    tick().catch((err) => log("error", "Tick failed", { err: String(err) }));
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
