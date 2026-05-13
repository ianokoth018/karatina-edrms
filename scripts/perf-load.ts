/**
 * Perf load — sustained load profile against /api/search.
 *
 *   BASE_URL=http://localhost:3000 \
 *   ADMIN_EMAIL=admin@karu.ac.ke \
 *   ADMIN_PASSWORD='Admin@2026' \
 *   npx tsx scripts/perf-load.ts
 *
 * Env:
 *   BASE_URL          default http://localhost:3000
 *   ADMIN_EMAIL       default admin@karu.ac.ke
 *   ADMIN_PASSWORD    default Admin@2026
 *   PERF_VUS          virtual users           (default 10)
 *   PERF_DURATION_S   seconds to sustain load (default 60)
 *   PERF_TARGET_PATH  endpoint under test     (default /api/search?q=test)
 *
 * Each "virtual user" is a fire-and-await loop sharing the same logged-in
 * cookie jar (next-auth JWT cookies are read-only on the client side, so
 * concurrent use is fine). We use Promise.allSettled across the VU
 * promises and aggregate timings at the end.
 *
 * stdlib http/https only — no autocannon.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@karu.ac.ke";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@2026";
const VUS = Number(process.env.PERF_VUS ?? "10");
const DURATION_S = Number(process.env.PERF_DURATION_S ?? "60");
const TARGET_PATH = process.env.PERF_TARGET_PATH ?? "/api/search?q=test";

// -----------------------------------------------------------------------
// Shared cookie jar + HTTP helpers (kept in-file so this script has zero
// internal imports — copy-paste safe for ad-hoc tweaks).
// -----------------------------------------------------------------------

class CookieJar {
  private jar = new Map<string, string>();
  ingest(headers: string[] | string | undefined): void {
    if (!headers) return;
    const list = Array.isArray(headers) ? headers : [headers];
    for (const raw of list) {
      const semi = raw.indexOf(";");
      const kv = semi === -1 ? raw : raw.slice(0, semi);
      const eq = kv.indexOf("=");
      if (eq === -1) continue;
      const name = kv.slice(0, eq).trim();
      const value = kv.slice(eq + 1).trim();
      if (!name) continue;
      if (value === "" || value === '""') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  header(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

interface FetchResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function rawFetch(
  url: string,
  opts: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    jar?: CookieJar;
    noFollow?: boolean;
  } = {},
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {
      "user-agent": "edrms-perf-load/1.0",
      accept: "application/json, text/plain, */*",
      ...(opts.headers ?? {}),
    };
    if (opts.jar) {
      const c = opts.jar.header();
      if (c) headers["cookie"] = c;
    }
    if (opts.body) {
      if (!headers["content-type"]) headers["content-type"] = "application/json";
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
          if (opts.jar) opts.jar.ingest(res.headers["set-cookie"]);
          const status = res.statusCode ?? 0;
          if (
            !opts.noFollow &&
            status >= 300 &&
            status < 400 &&
            res.headers.location
          ) {
            rawFetch(new URL(res.headers.location, url).toString(), {
              ...opts,
              method: "GET",
              body: undefined,
            })
              .then(resolve)
              .catch(reject);
            return;
          }
          resolve({
            status,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function login(jar: CookieJar): Promise<void> {
  const csrf = await rawFetch(`${BASE_URL}/api/auth/csrf`, { jar });
  const csrfToken = (JSON.parse(csrf.body) as { csrfToken: string }).csrfToken;
  const form = new URLSearchParams({
    csrfToken,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    callbackUrl: `${BASE_URL}/dashboard`,
    json: "true",
  }).toString();
  const login = await rawFetch(`${BASE_URL}/api/auth/callback/credentials`, {
    jar,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    noFollow: true,
  });
  if (login.status >= 400) {
    throw new Error(`login failed: ${login.status} ${login.body.slice(0, 200)}`);
  }
  const sess = await rawFetch(`${BASE_URL}/api/auth/session`, { jar });
  const parsed = JSON.parse(sess.body || "{}") as { user?: { email?: string } };
  if (!parsed.user?.email) {
    throw new Error("login did not stick");
  }
  console.log(`[perf-load] logged in as ${parsed.user.email}`);
}

// -----------------------------------------------------------------------
// VU loop
// -----------------------------------------------------------------------

interface Sample {
  ms: number;
  ok: boolean;
}

async function runVu(
  jar: CookieJar,
  deadline: number,
  samples: Sample[],
): Promise<void> {
  while (Date.now() < deadline) {
    const t = Date.now();
    let ok = false;
    try {
      const res = await rawFetch(`${BASE_URL}${TARGET_PATH}`, { jar });
      ok = res.status >= 200 && res.status < 400;
    } catch {
      ok = false;
    }
    samples.push({ ms: Date.now() - t, ok });
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `[perf-load] BASE_URL=${BASE_URL}  VUs=${VUS}  duration=${DURATION_S}s  ` +
      `target=${TARGET_PATH}`,
  );
  const jar = new CookieJar();
  await login(jar);

  // Warm-up call so Next compiles the route before measuring.
  await rawFetch(`${BASE_URL}${TARGET_PATH}`, { jar }).catch(() => undefined);

  const samples: Sample[] = [];
  const deadline = Date.now() + DURATION_S * 1000;

  // Periodic progress so the operator knows it's alive.
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const ok = samples.filter((s) => s.ok).length;
    const rps = samples.length / Math.max(0.001, elapsed);
    process.stdout.write(
      `  t=${elapsed.toFixed(0)}s  reqs=${samples.length}  rps=${rps.toFixed(1)}  ok=${ok}\n`,
    );
  }, 5000);

  const vus = Array.from({ length: VUS }, () => runVu(jar, deadline, samples));
  await Promise.allSettled(vus);
  clearInterval(ticker);

  const totalElapsed = (Date.now() - startedAt) / 1000;
  const ok = samples.filter((s) => s.ok).length;
  const errors = samples.length - ok;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const rps = samples.length / totalElapsed;
  const errRate = samples.length === 0 ? 0 : (errors / samples.length) * 100;

  console.log(`\n[perf-load] summary`);
  console.log(`  total requests : ${samples.length}`);
  console.log(`  duration       : ${totalElapsed.toFixed(1)}s`);
  console.log(`  throughput     : ${rps.toFixed(1)} req/s`);
  console.log(`  errors         : ${errors}  (${errRate.toFixed(2)}%)`);
  console.log(`  p50 latency    : ${percentile(sorted, 50)} ms`);
  console.log(`  p95 latency    : ${percentile(sorted, 95)} ms`);
  console.log(`  p99 latency    : ${percentile(sorted, 99)} ms`);
  console.log(`  max latency    : ${sorted[sorted.length - 1] ?? 0} ms`);
}

main().catch((err) => {
  console.error("[perf-load] fatal:", err);
  process.exit(1);
});
