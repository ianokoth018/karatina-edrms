// Walks `app/api/admin/` and reports which route files include the
// `admin:manage` permission check (or an equivalent gate). CI-style guard —
// reports only, never fixes.
//
// Run with: npx tsx scripts/audit-admin-permissions.ts

import { promises as fs } from "node:fs";
import path from "node:path";

const ADMIN_ROUTES_ROOT = path.join(process.cwd(), "app", "api", "admin");

/**
 * Heuristics for detecting an admin permission gate. We accept several
 * spellings so the audit doesn't flag false-positives on routes that
 * implement the gate through a helper or string variants.
 */
const GATE_PATTERNS: RegExp[] = [
  /permissions\??\.\s*includes\s*\(\s*['"`]admin:manage['"`]\s*\)/,
  /isAdmin\s*\(/,
  /requireAdmin\s*\(/,
  /assertAdmin\s*\(/,
  /['"`]admin:manage['"`]/,
];

interface RouteAuditRow {
  route: string;
  file: string;
  hasGate: boolean;
  matchedPattern: string | null;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function fileToRoute(file: string): string {
  const rel = path.relative(path.join(process.cwd(), "app"), file);
  // strip the trailing /route.ts
  const noRoute = rel.replace(/\/route\.ts$/, "");
  return "/" + noRoute.replace(/\\/g, "/");
}

async function auditFile(file: string): Promise<RouteAuditRow> {
  const contents = await fs.readFile(file, "utf8");
  let matched: string | null = null;
  for (const pattern of GATE_PATTERNS) {
    if (pattern.test(contents)) {
      matched = pattern.source;
      break;
    }
  }
  return {
    route: fileToRoute(file),
    file: path.relative(process.cwd(), file),
    hasGate: matched !== null,
    matchedPattern: matched,
  };
}

function renderMarkdown(rows: RouteAuditRow[]): string {
  const lines: string[] = [];
  lines.push("# Admin Endpoint Permission Audit");
  lines.push("");
  lines.push(`Scanned ${rows.length} route files under \`app/api/admin/\`.`);
  const missing = rows.filter((r) => !r.hasGate).length;
  lines.push(
    missing === 0
      ? "All routes detect an admin permission gate."
      : `**${missing}** route(s) appear to lack an admin permission gate.`,
  );
  lines.push("");
  lines.push("| Route | Gate detected | Matched pattern |");
  lines.push("| --- | --- | --- |");
  for (const row of rows) {
    const status = row.hasGate ? "yes" : "**MISSING**";
    const pattern = row.matchedPattern ? `\`${row.matchedPattern}\`` : "—";
    lines.push(`| \`${row.route}\` | ${status} | ${pattern} |`);
  }
  return lines.join("\n");
}

async function main() {
  try {
    await fs.access(ADMIN_ROUTES_ROOT);
  } catch {
    console.error(`No admin routes directory at ${ADMIN_ROUTES_ROOT}`);
    process.exit(1);
  }

  const files = (await walk(ADMIN_ROUTES_ROOT)).sort();
  const rows: RouteAuditRow[] = [];
  for (const file of files) {
    rows.push(await auditFile(file));
  }

  const md = renderMarkdown(rows);
  console.log(md);

  const missing = rows.filter((r) => !r.hasGate);
  if (missing.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
