// Smoke-test harness for EDRMS new-feature modules.
//
//   npx tsx scripts/smoke-test.ts
//
// Each module is imported in isolation and exercised through a tiny non-network
// code path. Failures don't abort the run — every check prints PASS/FAIL and
// the script exits non-zero if anything failed. Designed to surface broken
// imports, missing exports, or trivial runtime errors BEFORE manual browser
// testing starts.

import { db } from "@/lib/db";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string, error?: string) {
  results.push({ name, ok, detail, error });
  const tag = ok ? "PASS" : "FAIL";
  const suffix = ok
    ? detail
      ? `  ${detail}`
      : ""
    : `  ${error ?? "(no error message)"}`;
  console.log(`  [${tag}] ${name}${suffix}`);
}

async function runCheck(
  name: string,
  fn: () => Promise<string | undefined> | string | undefined
): Promise<void> {
  try {
    const detail = await fn();
    record(name, true, detail ?? undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, undefined, msg);
  }
}

async function moduleChecks(): Promise<void> {
  console.log("\n== Module-load smoke ==");

  await runCheck("lib/ai-client.ts → aiEnabled()", async () => {
    const mod = await import("@/lib/ai-client");
    const enabled = mod.aiEnabled();
    return `aiEnabled=${enabled}`;
  });

  await runCheck("lib/ai/config.ts → getActiveProvider()", async () => {
    const mod = await import("@/lib/ai/config");
    const provider = mod.getActiveProvider();
    return `activeProvider=${provider ?? "none"}`;
  });

  await runCheck(
    "lib/ai/provider.ts → import getStructuredCompletion",
    async () => {
      const mod = await import("@/lib/ai/provider");
      if (typeof mod.getStructuredCompletion !== "function") {
        throw new Error("getStructuredCompletion is not a function");
      }
      return "import ok";
    }
  );

  await runCheck("lib/ai-classify.ts → import classifyDocument", async () => {
    const mod = await import("@/lib/ai-classify");
    if (typeof mod.classifyDocument !== "function") {
      throw new Error("classifyDocument is not a function");
    }
    return "import ok";
  });

  await runCheck("lib/ai-search.ts → import rewriteSearchQuery", async () => {
    const mod = await import("@/lib/ai-search");
    if (typeof mod.rewriteSearchQuery !== "function") {
      throw new Error("rewriteSearchQuery is not a function");
    }
    return "import ok";
  });

  await runCheck(
    "lib/audit.ts → import writeAudit, computeRowHash, canonicalRowJson",
    async () => {
      const mod = await import("@/lib/audit");
      if (typeof mod.writeAudit !== "function") {
        throw new Error("writeAudit is not a function");
      }
      if (typeof mod.computeRowHash !== "function") {
        throw new Error("computeRowHash is not a function");
      }
      if (typeof mod.canonicalRowJson !== "function") {
        throw new Error("canonicalRowJson is not a function");
      }
      return "import ok";
    }
  );

  await runCheck("lib/audit-verify.ts → import verifyAuditChain", async () => {
    const mod = await import("@/lib/audit-verify");
    if (typeof mod.verifyAuditChain !== "function") {
      throw new Error("verifyAuditChain is not a function");
    }
    return "import ok";
  });

  await runCheck("lib/document-access.ts → access helpers", async () => {
    const mod = await import("@/lib/document-access");
    if (typeof mod.buildDocumentAccessWhere !== "function") {
      throw new Error("buildDocumentAccessWhere is not a function");
    }
    if (!Array.isArray(mod.CLASSIFICATION_ORDER)) {
      throw new Error("CLASSIFICATION_ORDER is not an array");
    }
    const ord = mod.classificationOrdinal("RESTRICTED");
    const atOrBelow = mod.classificationsAtOrBelow("RESTRICTED");
    const can = mod.canUserReadClassification("SECRET", "RESTRICTED");
    return `order=${mod.CLASSIFICATION_ORDER.length} ord(RESTRICTED)=${ord} atOrBelow=${atOrBelow.length} SECRET→RESTRICTED=${can}`;
  });

  await runCheck("lib/document-locks.ts → lock helpers", async () => {
    const mod = await import("@/lib/document-locks");
    if (typeof mod.isDocumentLockedForMutation !== "function") {
      throw new Error("isDocumentLockedForMutation is not a function");
    }
    if (typeof mod.acquireExternalLock !== "function") {
      throw new Error("acquireExternalLock is not a function");
    }
    if (typeof mod.releaseExternalLock !== "function") {
      throw new Error("releaseExternalLock is not a function");
    }
    return "import ok";
  });

  await runCheck("lib/embed-token.ts → mint+verify round-trip", async () => {
    const mod = await import("@/lib/embed-token");
    const { token } = mod.createDocEmbedToken("doc-smoke", "user-smoke", 60);
    const ver = mod.verifyDocEmbedToken(token);
    if (!ver.ok) throw new Error(`verify failed: ${ver.reason}`);
    if (ver.documentId !== "doc-smoke" || ver.userId !== "user-smoke") {
      throw new Error("round-trip payload mismatch");
    }
    return "round-trip ok";
  });

  await runCheck("lib/memo-qr.ts → import only (needs APP_URL)", async () => {
    const mod = await import("@/lib/memo-qr");
    if (typeof mod.generateMemoVerificationQrPng !== "function") {
      throw new Error("generateMemoVerificationQrPng is not a function");
    }
    if (typeof mod.buildMemoVerificationUrl !== "function") {
      throw new Error("buildMemoVerificationUrl is not a function");
    }
    return "import ok";
  });

  await runCheck("lib/memo-share.ts → mint+verify round-trip", async () => {
    const mod = await import("@/lib/memo-share");
    const token = mod.createMemoShareToken("memo-smoke", 1);
    const ver = mod.verifyMemoShareToken(token);
    if (!ver.ok) throw new Error(`verify failed: ${ver.reason}`);
    if (ver.memoId !== "memo-smoke") throw new Error("round-trip id mismatch");
    return "round-trip ok";
  });

  await runCheck("lib/version-diff.ts → diffText + diffMetadata", async () => {
    const mod = await import("@/lib/version-diff");
    const lines = mod.diffText("a\nb\nc", "a\nB\nc");
    const adds = lines.filter((l) => l.type === "add").length;
    const dels = lines.filter((l) => l.type === "del").length;
    const eq = lines.filter((l) => l.type === "equal").length;
    const meta = mod.diffMetadata({ x: 1 }, { x: 2, y: 3 });
    return `lines=(eq:${eq}, add:${adds}, del:${dels}) metaChanges=${meta.length}`;
  });

  await runCheck(
    'lib/cron.ts → parseCron("0 9 * * 1") + nextFireTime',
    async () => {
      const mod = await import("@/lib/cron");
      const parsed = mod.parseCron("0 9 * * 1");
      if (!parsed) throw new Error("parseCron returned null");
      const next = mod.nextFireTime(parsed, new Date(), "Africa/Nairobi");
      return `nextFireTime=${next.toISOString()}`;
    }
  );

  await runCheck("lib/workflow-simulator.ts → start → end trace", async () => {
    const mod = await import("@/lib/workflow-simulator");
    const result = mod.simulateWorkflow(
      {
        nodes: [
          { id: "s", type: "start", data: { label: "Start" } },
          { id: "e", type: "end", data: { label: "End", outcome: "ok" } },
        ],
        edges: [{ source: "s", target: "e" }],
      },
      {}
    );
    return `steps=${result.steps.length} terminator=${result.terminator} ok=${result.ok}`;
  });

  await runCheck(
    "lib/workflow-triggers.ts → import trigger evaluators",
    async () => {
      const mod = await import("@/lib/workflow-triggers");
      if (typeof mod.evaluateTriggers !== "function") {
        throw new Error("evaluateTriggers is not a function");
      }
      if (typeof mod.evaluateFormSubmitTriggers !== "function") {
        throw new Error("evaluateFormSubmitTriggers is not a function");
      }
      if (typeof mod.evaluateScheduledTriggers !== "function") {
        throw new Error("evaluateScheduledTriggers is not a function");
      }
      return "import ok";
    }
  );

  await runCheck("lib/branding.ts → getBranding()", async () => {
    const mod = await import("@/lib/branding");
    const b = await mod.getBranding();
    return `orgName="${b.orgName}"`;
  });

  await runCheck("lib/webhook-signing.ts → sign+verify round-trip", async () => {
    const mod = await import("@/lib/webhook-signing");
    const body = JSON.stringify({ smoke: true, n: 1 });
    const secret = "smoke-secret";
    const { signature, timestamp } = mod.signWebhookPayload(body, secret);
    const ok = mod.verifyWebhookSignature({ body, signature, timestamp, secret });
    if (!ok) throw new Error("verifyWebhookSignature returned false");
    // Also assert that a wrong-secret verify fails.
    const bad = mod.verifyWebhookSignature({
      body,
      signature,
      timestamp,
      secret: "other-secret",
    });
    if (bad) throw new Error("verifyWebhookSignature accepted wrong secret");
    return "round-trip ok, wrong-secret rejected";
  });

  await runCheck("lib/settings.ts → getWatermarkConfig()", async () => {
    const mod = await import("@/lib/settings");
    const wm = await mod.getWatermarkConfig();
    return `enabled=${wm.enabled} minClassification=${wm.minClassification} text="${wm.text}"`;
  });
}

interface ColumnRow {
  column_name: string;
}

interface IndexRow {
  indexname: string;
}

interface TableExistsRow {
  exists: boolean;
}

async function dbInvariants(): Promise<void> {
  console.log("\n== DB invariants ==");

  await runCheck("audit_logs has hash + prevHash columns", async () => {
    const cols = await db.$queryRawUnsafe<ColumnRow[]>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs'"
    );
    const names = new Set(cols.map((c) => c.column_name));
    const missing = ["hash", "prevHash"].filter((c) => !names.has(c));
    if (missing.length > 0) {
      throw new Error(`missing columns: ${missing.join(", ")}`);
    }
    return `cols=${cols.length} (has hash + prevHash)`;
  });

  await runCheck("document_external_locks table exists", async () => {
    const rows = await db.$queryRawUnsafe<TableExistsRow[]>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_external_locks') AS exists"
    );
    if (!rows[0]?.exists) throw new Error("table not found");
    return "exists";
  });

  await runCheck("search_logs table exists", async () => {
    const rows = await db.$queryRawUnsafe<TableExistsRow[]>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'search_logs') AS exists"
    );
    if (!rows[0]?.exists) throw new Error("table not found");
    return "exists";
  });

  await runCheck("FTS index idx_documents_fts exists", async () => {
    const rows = await db.$queryRawUnsafe<IndexRow[]>(
      "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_documents_fts%'"
    );
    if (rows.length === 0) throw new Error("no index matched 'idx_documents_fts%'");
    return `found ${rows.map((r) => r.indexname).join(", ")}`;
  });

  await runCheck("verifyAuditChain() over current log", async () => {
    const { verifyAuditChain } = await import("@/lib/audit-verify");
    const r = await verifyAuditChain();
    if (!r.ok) {
      throw new Error(
        `chain broken: total=${r.total} badCount=${r.badCount} unhashedCount=${r.unhashedCount} firstBadId=${r.firstBadId}`
      );
    }
    return `ok=${r.ok} total=${r.total} badCount=${r.badCount} unhashedCount=${r.unhashedCount}`;
  });
}

interface EndpointRow {
  method: string;
  path: string;
  auth: string;
}

function endpointTable(): void {
  console.log("\n== Endpoint coverage (manual smoke checklist) ==\n");
  const rows: EndpointRow[] = [
    { method: "GET", path: "/api/admin/reports/overview", auth: "admin" },
    { method: "POST", path: "/api/admin/audit-integrity/verify", auth: "admin" },
    { method: "GET", path: "/api/admin/search-analytics", auth: "admin" },
    { method: "GET", path: "/api/admin/watermark", auth: "admin" },
    { method: "PUT", path: "/api/admin/watermark", auth: "admin" },
    { method: "GET", path: "/api/admin/branding", auth: "admin" },
    { method: "PUT", path: "/api/admin/branding", auth: "admin" },
    { method: "GET", path: "/api/admin/sso/probe", auth: "admin" },
    { method: "GET", path: "/api/openapi", auth: "public" },
    { method: "POST", path: "/api/documents/[id]/ai-classify", auth: "session" },
    { method: "POST", path: "/api/documents/[id]/external-lock", auth: "session" },
    { method: "DELETE", path: "/api/documents/[id]/external-lock", auth: "session" },
    { method: "POST", path: "/api/documents/[id]/embed-token", auth: "session" },
    { method: "POST", path: "/api/documents/[id]/redactions", auth: "session" },
    { method: "GET", path: "/api/documents/[id]/versions/compare", auth: "session" },
    { method: "POST", path: "/api/workflows/simulate", auth: "session" },
    { method: "GET", path: "/api/workflows/triggers", auth: "session" },
    { method: "POST", path: "/api/workflows/triggers", auth: "session" },
    { method: "POST", path: "/api/public/forms/[id]/submissions", auth: "public" },
    { method: "GET", path: "/api/search?ai=1", auth: "session" },
  ];

  const methodW = Math.max(6, ...rows.map((r) => r.method.length));
  const pathW = Math.max(4, ...rows.map((r) => r.path.length));
  const authW = Math.max(4, ...rows.map((r) => r.auth.length));

  const header = `| ${"Method".padEnd(methodW)} | ${"Path".padEnd(pathW)} | ${"Auth".padEnd(authW)} |`;
  const sep = `| ${"-".repeat(methodW)} | ${"-".repeat(pathW)} | ${"-".repeat(authW)} |`;
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `| ${r.method.padEnd(methodW)} | ${r.path.padEnd(pathW)} | ${r.auth.padEnd(authW)} |`
    );
  }
}

async function main(): Promise<void> {
  console.log("EDRMS smoke test");
  console.log("================");

  await moduleChecks();

  try {
    await dbInvariants();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [FAIL] DB invariants section blew up: ${msg}`);
    results.push({ name: "DB invariants section", ok: false, error: msg });
  } finally {
    try {
      await db.$disconnect();
    } catch {
      // ignore disconnect errors
    }
  }

  endpointTable();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failed checks:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke-test: fatal", err);
  process.exit(1);
});
