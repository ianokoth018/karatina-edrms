/**
 * Email Capture Worker — IMAP Inbox Watcher
 *
 * Watches email inboxes configured on CaptureProfiles with sourceType=EMAIL.
 * Downloads PDF attachments and drops them into the profile's folderPath
 * so the main hot-folder capture-worker picks them up automatically.
 *
 * Usage:
 *   npx tsx scripts/email-capture-worker.ts
 */

import { PrismaClient } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { promises as fs } from "fs";
import path from "path";
import { decryptSecret } from "../lib/encryption";

const prisma = new PrismaClient();
const POLL_INTERVAL_MS = 60_000;

const GREEN = "\x1b[32m"; const YELLOW = "\x1b[33m";
const RED = "\x1b[31m"; const RESET = "\x1b[0m"; const BOLD = "\x1b[1m";

function log(level: "info" | "warn" | "error", msg: string, ctx?: Record<string, unknown>) {
  const prefix = { info: `${GREEN}INFO${RESET}`, warn: `${YELLOW}WARN${RESET}`, error: `${RED}ERROR${RESET}` }[level];
  const ts = new Date().toISOString();
  console.log(`${ts} ${prefix}  ${msg}`, ctx ? JSON.stringify(ctx) : "");
}

async function processProfile(profile: {
  id: string; name: string; folderPath: string;
  imapHost: string | null; imapPort: number | null; imapUser: string | null;
  imapPassword: string | null; imapFolder: string | null;
  imapSenderFilter: string | null; imapSubjectFilter: string | null;
}) {
  if (!profile.imapHost || !profile.imapUser || !profile.imapPassword) {
    log("warn", `Profile ${profile.name}: IMAP not fully configured — skipping`);
    return;
  }

  let password: string;
  try {
    password = decryptSecret(profile.imapPassword);
  } catch {
    password = profile.imapPassword; // fallback: plaintext (dev mode)
  }

  const client = new ImapFlow({
    host: profile.imapHost,
    port: profile.imapPort ?? 993,
    secure: (profile.imapPort ?? 993) === 993,
    auth: { user: profile.imapUser, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const folder = profile.imapFolder ?? "INBOX";
    await client.mailboxOpen(folder);

    const senderRe = profile.imapSenderFilter ? new RegExp(profile.imapSenderFilter, "i") : null;
    const subjectRe = profile.imapSubjectFilter ? new RegExp(profile.imapSubjectFilter, "i") : null;

    // Fetch unseen messages
    for await (const msg of client.fetch({ seen: false }, { envelope: true })) {
      if (!msg.envelope) continue;
      const from = msg.envelope.from?.[0]?.address ?? "";
      const subject = msg.envelope?.subject ?? "";

      if (senderRe && !senderRe.test(from)) continue;
      if (subjectRe && !subjectRe.test(subject)) continue;

      // Download message to get attachments
      const full = await client.fetchOne(String(msg.seq), { bodyStructure: true, source: true });
      if (!full) continue;

      let attachmentCount = 0;
      if (full.bodyStructure && Array.isArray(full.bodyStructure.childNodes)) {
        for (const part of full.bodyStructure.childNodes) {
          const fname = (part.parameters as Record<string, string> | undefined)?.name
            ?? (part.dispositionParameters as Record<string, string> | undefined)?.filename;
          if (!fname) continue;
          if (!fname.toLowerCase().endsWith(".pdf") && !fname.toLowerCase().match(/\.(tiff?|jpg|jpeg|png)$/)) continue;

          try {
            const destPath = path.join(profile.folderPath, fname);
            const stream = await client.download(String(msg.seq), part.part as string ?? "1");
            if (stream) {
              const chunks: Buffer[] = [];
              for await (const chunk of stream.content) chunks.push(chunk as Buffer);
              await fs.mkdir(profile.folderPath, { recursive: true });
              await fs.writeFile(destPath, Buffer.concat(chunks));
              attachmentCount++;
              log("info", `Saved attachment: ${fname}`, { profile: profile.name, from, subject });
            }
          } catch (err) {
            log("warn", `Failed to save attachment`, { fname, err: String(err) });
          }
        }
      }

      // Mark as seen after processing
      await client.messageFlagsAdd(String(msg.seq), ["\\Seen"]);

      // Log to CaptureLog
      await prisma.captureLog.create({
        data: {
          profileId: profile.id, fileName: subject, filePath: `email:${from}`,
          status: attachmentCount > 0 ? "CAPTURED" : "SKIPPED",
          metadata: { source: "email", from, subject, attachmentCount, messageId: msg.envelope?.messageId },
          processedAt: new Date(),
        },
      }).catch(() => null);
    }

    await client.mailboxClose();
  } catch (err) {
    log("error", `IMAP error for profile ${profile.name}`, { err: String(err) });
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

async function main() {
  log("info", `${BOLD}Email Capture Worker${RESET} starting`);

  async function tick() {
    const profiles = await prisma.captureProfile.findMany({
      where: { isActive: true, sourceType: "EMAIL" },
      select: {
        id: true, name: true, folderPath: true,
        imapHost: true, imapPort: true, imapUser: true, imapPassword: true,
        imapFolder: true, imapSenderFilter: true, imapSubjectFilter: true,
      },
    });
    if (profiles.length === 0) {
      log("info", "No EMAIL profiles found");
      return;
    }
    log("info", `Checking ${profiles.length} EMAIL profile(s)`);
    await Promise.allSettled(profiles.map(processProfile));
  }

  await tick();
  const timer = setInterval(tick, POLL_INTERVAL_MS);

  process.on("SIGTERM", () => { clearInterval(timer); prisma.$disconnect(); process.exit(0); });
  process.on("SIGINT",  () => { clearInterval(timer); prisma.$disconnect(); process.exit(0); });
}

main().catch((err) => { console.error(err); process.exit(1); });
