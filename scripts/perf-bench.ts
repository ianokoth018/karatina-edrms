/**
 * Perf bench — measures latency of the critical EDRMS endpoints against a
 * running dev/prod server.
 *
 *   BASE_URL=http://localhost:3000 \
 *   ADMIN_EMAIL=admin@karu.ac.ke \
 *   ADMIN_PASSWORD='Admin@2026' \
 *   npx tsx scripts/perf-bench.ts
 *
 * Env:
 *   BASE_URL          default http://localhost:3000
 *   ADMIN_EMAIL       default admin@karu.ac.ke
 *   ADMIN_PASSWORD    default Admin@2026
 *   PERF_ITERATIONS   default 50
 *
 * Output:
 *   - Markdown table on stdout (route, p50, p95, p99, req/s, errors)
 *   - perf-results-<ts>.csv with the raw per-call timings for offline analysis
 *
 * Login flow mirrors what a browser would do against next-auth v5:
 *   1. GET  /api/auth/csrf                 → grab csrfToken + the cookie
 *   2. POST /api/auth/callback/credentials → email + password + csrfToken
 *      (the Set-Cookie on the redirect response carries the session JWT)
 *
 * No third-party HTTP client; we use Node's stdlib http/https and a tiny
 * cookie jar.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { writeFileSync } from "node:fs";

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@karu.ac.ke";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@2026";
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? "50");

// -----------------------------------------------------------------------
// Cookie jar + HTTP client (stdlib only)
// -----------------------------------------------------------------------

class CookieJar {
  private jar = new Map<string, string>();

  ingestSetCookie(headers: string[] | string | undefined): void {
    if (!headers) return;
    const list = Array.isArray(headers) ? headers : [headers];
    for (const raw of list) {
      // We only care about the "name=value" segment before the first ';'.
      const semi = raw.indexOf(";");
      const kv = semi === -1 ? raw : raw.slice(0, semi);
      const eq = kv.indexOf("=");
      if (eq === -1) continue;
      const name = kv.slice(0, eq).trim();
      const value = kv.slice(eq + 1).trim();
      if (!name) continue;
      if (value === "" || value === '""') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  header(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  jar?: CookieJar;
  /** If true, do NOT follow 3xx redirects (NextAuth callbacks rely on this). */
  noFollow?: boolean;
}

interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  url: string;
}

function rawFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {
      "user-agent": "edrms-perf-bench/1.0",
      accept: "application/json, text/plain, */*",
      ...(opts.headers ?? {}),
    };
    if (opts.jar) {
      const cookie = opts.jar.header();
      if (cookie) headers["cookie"] = cookie;
    }
    if (opts.body && headers["content-type"] === undefined) {
      headers["content-type"] = "application/json";
    }
    if (opts.body) {
      headers["content-length"] = Buffer.byteLength(opts.body).toString();
    }

    const req = transport(
      {
        method: opts.method ?? "GET",
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          if (opts.jar) {
            opts.jar.ingestSetCookie(res.headers["set-cookie"]);
          }
          const status = res.statusCode ?? 0;
          // Manual redirect follow (unless caller opted out).
          if (
            !opts.noFollow &&
            status >= 300 &&
            status < 400 &&
            res.headers.location
          ) {
            const next = new URL(res.headers.location, url).toString();
            rawFetch(next, { ...opts, method: "GET", body: undefined })
              .then(resolve)
              .catch(reject);
            return;
          }
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            url,
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// -----------------------------------------------------------------------
// Login (NextAuth v5 credentials)
// -----------------------------------------------------------------------

async function login(jar: CookieJar): Promise<void> {
  // 1. CSRF
  const csrfRes = await rawFetch(`${BASE_URL}/api/auth/csrf`, { jar });
  if (csrfRes.status !== 200) {
    throw new Error(`csrf fetch failed: ${csrfRes.status} ${csrfRes.body}`);
  }
  let csrfToken: string;
  try {
    csrfToken = (JSON.parse(csrfRes.body) as { csrfToken: string }).csrfToken;
  } catch {
    throw new Error(`csrf body not JSON: ${csrfRes.body.slice(0, 120)}`);
  }
  if (!csrfToken) throw new Error("csrfToken missing from response");

  // 2. Credentials callback. The form-encoded body matches what next-auth's
  // signIn() helper posts when called from the browser. Pass noFollow so we
  // can inspect the redirect status before the cookie jar walks away.
  const form = new URLSearchParams({
    csrfToken,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    callbackUrl: `${BASE_URL}/dashboard`,
    json: "true",
  }).toString();

  const loginRes = await rawFetch(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      jar,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      noFollow: true,
    },
  );

  // next-auth returns either 200 (json:true) or 302; both are OK provided
  // a session cookie was set. Anything 4xx/5xx means bad credentials.
  if (loginRes.status >= 400) {
    throw new Error(
      `login failed: ${loginRes.status} ${loginRes.body.slice(0, 200)}`,
    );
  }

  // Sanity check: verify we now have a session.
  const sess = await rawFetch(`${BASE_URL}/api/auth/session`, { jar });
  if (sess.status !== 200) {
    throw new Error(`session check failed: ${sess.status}`);
  }
  let parsed: { user?: { email?: string } } = {};
  try {
    parsed = JSON.parse(sess.body) as { user?: { email?: string } };
  } catch {
    /* ignore — empty body when not signed in */
  }
  if (!parsed.user?.email) {
    throw new Error(`session has no user — login did not stick (body: ${sess.body.slice(0, 200)})`);
  }
  console.log(`[perf-bench] logged in as ${parsed.user.email}`);
}

// -----------------------------------------------------------------------
// Stats
// -----------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

interface RouteSpec {
  label: string;
  method: "GET" | "POST";
  path: string;
  body?: () => string;
}

interface RouteResult {
  label: string;
  method: string;
  path: string;
  timingsMs: number[];
  errors: number;
  totalMs: number;
}

async function runRoute(
  jar: CookieJar,
  spec: RouteSpec,
  iterations: number,
): Promise<RouteResult> {
  const timings: number[] = [];
  let errors = 0;
  const t0 = Date.now();
  for (let i = 0; i < iterations; i++) {
    const t = Date.now();
    try {
      const res = await rawFetch(`${BASE_URL}${spec.path}`, {
        jar,
        method: spec.method,
        body: spec.body?.(),
      });
      const ms = Date.now() - t;
      if (res.status >= 400) {
        errors++;
        if (errors <= 3) {
          console.warn(
            `  ! ${spec.label} status=${res.status} body=${res.body.slice(0, 120)}`,
          );
        }
      }
      timings.push(ms);
    } catch (e) {
      errors++;
      timings.push(Date.now() - t);
      if (errors <= 3) {
        console.warn(`  ! ${spec.label} threw:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return {
    label: spec.label,
    method: spec.method,
    path: spec.path,
    timingsMs: timings,
    errors,
    totalMs: Date.now() - t0,
  };
}

// -----------------------------------------------------------------------
// Routes under test
// -----------------------------------------------------------------------

const simulateBody = (): string =>
  JSON.stringify({
    definition: {
      nodes: [
        { id: "s", type: "start", data: { label: "Start" } },
        { id: "t1", type: "userTask", data: { label: "Task 1" } },
        { id: "t2", type: "userTask", data: { label: "Task 2" } },
        { id: "e", type: "end", data: { label: "End", outcome: "ok" } },
      ],
      edges: [
        { source: "s", target: "t1" },
        { source: "t1", target: "t2" },
        { source: "t2", target: "e" },
      ],
    },
    formData: {},
  });

const ROUTES: RouteSpec[] = [
  { label: "documents.list",         method: "GET",  path: "/api/documents?limit=20" },
  { label: "search.fts",             method: "GET",  path: "/api/search?q=contract" },
  { label: "search.fts.noAi",        method: "GET",  path: "/api/search?q=contract&ai=0" },
  { label: "reports.overview.30d",   method: "GET",  path: "/api/admin/reports/overview?sinceDays=30" },
  { label: "search-analytics.30d",   method: "GET",  path: "/api/admin/search-analytics?sinceDays=30" },
  { label: "workflows.simulate",     method: "POST", path: "/api/workflows/simulate", body: simulateBody },
];

// -----------------------------------------------------------------------
// Output
// -----------------------------------------------------------------------

function formatTable(results: RouteResult[]): string {
  const header = `| Route | Method | p50 (ms) | p95 (ms) | p99 (ms) | req/s | errors |`;
  const sep    = `| ----- | ------ | -------- | -------- | -------- | ----- | ------ |`;
  const rows = results.map((r) => {
    const sorted = [...r.timingsMs].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const rps = r.timingsMs.length / (r.totalMs / 1000);
    return `| ${r.label} | ${r.method} | ${p50} | ${p95} | ${p99} | ${rps.toFixed(1)} | ${r.errors} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function writeCsv(results: RouteResult[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `perf-results-${stamp}.csv`;
  const lines = ["label,method,path,iteration,ms,error_count"];
  for (const r of results) {
    r.timingsMs.forEach((ms, i) => {
      lines.push(`${r.label},${r.method},${r.path},${i},${ms},${r.errors}`);
    });
  }
  writeFileSync(path, lines.join("\n"));
  return path;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[perf-bench] BASE_URL=${BASE_URL}  iterations=${ITERATIONS}`);
  const jar = new CookieJar();
  await login(jar);

  // Warm-up: one call per route so Next compiles each handler before timing.
  console.log(`[perf-bench] warming up…`);
  for (const r of ROUTES) {
    await rawFetch(`${BASE_URL}${r.path}`, {
      jar,
      method: r.method,
      body: r.body?.(),
    }).catch(() => undefined);
  }

  const results: RouteResult[] = [];
  for (const spec of ROUTES) {
    process.stdout.write(`[perf-bench]   ${spec.label} (${ITERATIONS}x)… `);
    const r = await runRoute(jar, spec, ITERATIONS);
    const sorted = [...r.timingsMs].sort((a, b) => a - b);
    console.log(
      `p50=${percentile(sorted, 50)}ms p95=${percentile(sorted, 95)}ms p99=${percentile(sorted, 99)}ms errors=${r.errors}`,
    );
    results.push(r);
  }

  console.log(`\n${formatTable(results)}`);
  const csv = writeCsv(results);
  console.log(`\nRaw timings: ${csv}`);
}

main().catch((err) => {
  console.error("[perf-bench] fatal:", err);
  process.exit(1);
});
