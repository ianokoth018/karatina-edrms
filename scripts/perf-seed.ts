/**
 * Perf seed — generates synthetic Document + DocumentFile rows so we can
 * benchmark critical paths at realistic scale.
 *
 *   PERF_DOC_COUNT=50000 npx tsx scripts/perf-seed.ts
 *
 * Knobs (all env-driven):
 *   PERF_DOC_COUNT   total documents to ensure exist (default 50_000)
 *   PERF_DEPT_COUNT  number of synthetic departments (default 12)
 *   PERF_USER_COUNT  number of synthetic users to create (default 30)
 *
 * Flags:
 *   --clean   drop everything tagged "PERF-" (DocumentFile rows cascade via
 *             the Document FK), then exit.
 *
 * Idempotent: counts existing PERF-* documents and only inserts the gap so
 * re-running picks up where it left off. No actual files are written —
 * `storagePath` is synthetic since this is a DB load test, not a storage
 * test. OCR text is ~3000 chars of pseudo-business prose so FTS has real
 * content to match.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

const DOC_COUNT = Number(process.env.PERF_DOC_COUNT ?? "50000");
const DEPT_COUNT = Number(process.env.PERF_DEPT_COUNT ?? "12");
const USER_COUNT = Number(process.env.PERF_USER_COUNT ?? "30");
const BATCH_SIZE = 500;
const PERF_PREFIX = "PERF-";

const DOC_TYPES = ["MEMO", "LETTER", "CONTRACT", "INVOICE", "REPORT"] as const;
const CLASSIFICATIONS = [
  "OPEN",
  "CONFIDENTIAL",
  "RESTRICTED",
  "SECRET",
  "TOP_SECRET",
] as const;
const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

const TITLE_TEMPLATES = [
  "Quarterly Performance Review",
  "Procurement Authorisation Request",
  "Departmental Budget Memo",
  "Contract Renewal Notice",
  "Internal Audit Findings",
  "Vendor Service Agreement",
  "Staff Training Plan",
  "Capital Expenditure Proposal",
  "Project Status Report",
  "Risk Register Update",
  "Compliance Checklist",
  "Incident Response Note",
  "Travel Authorisation",
  "Stakeholder Briefing",
  "Operational Continuity Plan",
  "Asset Disposal Schedule",
  "Policy Revision Draft",
  "Annual Returns Filing",
  "Board Resolution Memo",
  "Tender Evaluation Report",
];

const SUBJECT_WORDS = [
  "aviation",
  "safety",
  "regulation",
  "compliance",
  "audit",
  "budget",
  "procurement",
  "contract",
  "stakeholder",
  "incident",
  "training",
  "performance",
  "operations",
  "directorate",
  "secretariat",
  "approval",
  "review",
  "schedule",
  "renewal",
  "advisory",
  "circular",
  "memorandum",
  "directive",
  "framework",
  "policy",
  "guideline",
  "standard",
  "procedure",
  "Karatina",
  "university",
  "tribunal",
  "Authority",
];

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPastDate(yearsBack: number): Date {
  const now = Date.now();
  const span = yearsBack * 365 * 24 * 60 * 60 * 1000;
  return new Date(now - Math.floor(Math.random() * span));
}

function makeWordRun(approxChars: number): string {
  const parts: string[] = [];
  let len = 0;
  while (len < approxChars) {
    const w = pick(SUBJECT_WORDS);
    parts.push(w);
    len += w.length + 1;
  }
  return parts.join(" ");
}

function makeDescription(): string {
  // ~200 chars
  return `${pick(TITLE_TEMPLATES)} — ${makeWordRun(170)}`;
}

function makeOcrText(): string {
  // ~3000 chars of pseudo-business prose, with a few real-ish keywords
  // sprinkled in (contract / invoice / approval) so FTS queries actually
  // match a non-trivial slice of the dataset.
  return `${pick(TITLE_TEMPLATES)}. ${makeWordRun(2900)}`;
}

function makeTitle(i: number): string {
  return `${PERF_PREFIX}${pick(TITLE_TEMPLATES)} #${i.toString().padStart(7, "0")}`;
}

function makeReferenceNumber(i: number): string {
  return `${PERF_PREFIX}REF-${i.toString().padStart(7, "0")}`;
}

// -----------------------------------------------------------------------
// Clean mode
// -----------------------------------------------------------------------

async function clean(): Promise<void> {
  console.log(`[perf-seed] --clean: dropping all PERF-* documents…`);
  const t0 = Date.now();
  const res = await db.document.deleteMany({
    where: { title: { startsWith: PERF_PREFIX } },
  });
  console.log(
    `[perf-seed] deleted ${res.count} documents in ${(Date.now() - t0) / 1000}s ` +
      `(DocumentFile rows cascaded via FK)`,
  );

  const userRes = await db.user.deleteMany({
    where: { email: { startsWith: "perf-user-" } },
  });
  console.log(`[perf-seed] deleted ${userRes.count} synthetic users`);
}

// -----------------------------------------------------------------------
// Main seed
// -----------------------------------------------------------------------

async function ensureUsers(): Promise<string[]> {
  const existing = await db.user.findMany({
    where: { email: { startsWith: "perf-user-" } },
    select: { id: true, email: true },
    orderBy: { email: "asc" },
  });
  const have = new Set(existing.map((u) => u.email));
  const password = await bcrypt.hash("PerfUser@2026", 10);

  const toCreate: Prisma.UserCreateManyInput[] = [];
  for (let i = 0; i < USER_COUNT; i++) {
    const email = `perf-user-${i.toString().padStart(4, "0")}@perf.local`;
    if (have.has(email)) continue;
    toCreate.push({
      email,
      name: `Perf User ${i}`,
      displayName: `Perf User ${i}`,
      password,
      department: `PERF Dept ${i % DEPT_COUNT}`,
      jobTitle: "Synthetic Tester",
      isActive: true,
    });
  }

  if (toCreate.length > 0) {
    console.log(`[perf-seed] creating ${toCreate.length} synthetic users…`);
    await db.user.createMany({ data: toCreate, skipDuplicates: true });
  }

  const all = await db.user.findMany({
    where: { email: { startsWith: "perf-user-" } },
    select: { id: true },
    orderBy: { email: "asc" },
  });
  return all.map((u) => u.id);
}

async function getStartingIndex(): Promise<number> {
  // Look at the highest existing PERF-REF-* number so re-runs append.
  const last = await db.document.findFirst({
    where: { referenceNumber: { startsWith: `${PERF_PREFIX}REF-` } },
    orderBy: { referenceNumber: "desc" },
    select: { referenceNumber: true },
  });
  if (!last) return 0;
  const m = last.referenceNumber.match(/REF-(\d+)$/);
  if (!m) return 0;
  return parseInt(m[1]!, 10) + 1;
}

async function seed(): Promise<void> {
  console.log(
    `[perf-seed] target=${DOC_COUNT} docs, ` +
      `${USER_COUNT} users, ${DEPT_COUNT} depts, batch=${BATCH_SIZE}`,
  );

  const userIds = await ensureUsers();
  if (userIds.length === 0) {
    throw new Error("No synthetic users available — aborting.");
  }
  console.log(`[perf-seed] have ${userIds.length} synthetic users`);

  const startIdx = await getStartingIndex();
  if (startIdx >= DOC_COUNT) {
    console.log(
      `[perf-seed] already at ${startIdx} PERF docs (target ${DOC_COUNT}) — nothing to do`,
    );
    return;
  }
  console.log(`[perf-seed] resuming from index ${startIdx}`);

  const t0 = Date.now();
  let inserted = 0;

  for (let i = startIdx; i < DOC_COUNT; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, DOC_COUNT);
    const docs: Prisma.DocumentCreateManyInput[] = [];
    const fileSeeds: { docId: string; index: number }[] = [];

    for (let j = i; j < end; j++) {
      const docId = randomUUID();
      docs.push({
        id: docId,
        referenceNumber: makeReferenceNumber(j),
        title: makeTitle(j),
        description: makeDescription(),
        documentType: pick(DOC_TYPES),
        status: pick(STATUSES),
        securityClassification: pick(CLASSIFICATIONS),
        createdById: userIds[j % userIds.length]!,
        department: `PERF Dept ${j % DEPT_COUNT}`,
        sourceSystem: "PERF_SEED",
        sourceId: `perf-${j}`,
        createdAt: randomPastDate(5),
      });
      fileSeeds.push({ docId, index: j });
    }

    const files: Prisma.DocumentFileCreateManyInput[] = fileSeeds.map((f) => ({
      documentId: f.docId,
      storagePath: `perf/synthetic/${f.index}.bin`,
      fileName: `perf-${f.index}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: BigInt(randInt(10_000, 4_000_000)),
      ocrText: makeOcrText(),
      ocrStatus: "COMPLETE",
    }));

    await db.$transaction([
      db.document.createMany({ data: docs, skipDuplicates: true }),
      db.documentFile.createMany({ data: files, skipDuplicates: true }),
    ]);

    inserted += docs.length;
    if (Math.floor((i + docs.length) / 1000) > Math.floor(i / 1000)) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = inserted / elapsed;
      const remaining = DOC_COUNT - (i + docs.length);
      const eta = remaining / Math.max(1, rate);
      console.log(
        `[perf-seed]  ${(i + docs.length).toLocaleString()} / ${DOC_COUNT.toLocaleString()} ` +
          `(${rate.toFixed(0)} docs/s, ETA ${eta.toFixed(0)}s)`,
      );
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `[perf-seed] done. Inserted ${inserted.toLocaleString()} docs in ${elapsed.toFixed(1)}s ` +
      `(${(inserted / elapsed).toFixed(0)} docs/s)`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--clean")) {
      await clean();
    } else {
      await seed();
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("[perf-seed] fatal:", err);
  process.exit(1);
});
