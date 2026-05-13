/**
 * External SIEM shipper.
 *
 * Pushes hash-chained audit rows to one of three configurable transports:
 *
 *   1. `splunk_hec`  — Splunk HTTP Event Collector (token auth, JSON body)
 *   2. `syslog_udp`  — RFC 5424 datagram via Node's stdlib `dgram`
 *   3. `http_json`   — Generic HTTPS POST (Bearer / custom auth header)
 *
 * Delivery is at-least-once: every `writeAudit` enqueues a `SiemShipLog`
 * row in PENDING state and fires a non-blocking `shipAuditEvent` call.
 * The worker (`scripts/siem-shipper-worker.ts`) sweeps PENDING + FAILED
 * rows on a 30s cadence and retries them up to MAX_RETRIES times before
 * marking them permanently FAILED for admin review.
 *
 * Configuration is 12-factor — every knob lives in env vars and the
 * shipper falls fully disabled (no-ops) if `SIEM_TARGET` is not set,
 * so unconfigured deployments incur zero cost.
 */

import dgram from "dgram";
import os from "os";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const MAX_ATTEMPTS = 10;
const HTTP_TIMEOUT_MS = 5_000;

export type SiemTarget = "splunk_hec" | "syslog_udp" | "http_json";

export function siemEnabled(): boolean {
  return !!getTarget();
}

export function getTarget(): SiemTarget | null {
  const t = (process.env.SIEM_TARGET ?? "").trim().toLowerCase();
  if (t === "splunk_hec" || t === "syslog_udp" || t === "http_json") {
    return t;
  }
  return null;
}

/**
 * Non-sensitive config snapshot for the admin page. Tokens / passwords
 * are masked — only their *presence* is reported.
 */
export function getSiemConfig() {
  const target = getTarget();
  return {
    enabled: !!target,
    target,
    splunk: {
      url: process.env.SIEM_SPLUNK_URL ?? "",
      tokenSet: !!process.env.SIEM_SPLUNK_TOKEN,
      tokenMasked: maskToken(process.env.SIEM_SPLUNK_TOKEN),
    },
    syslog: {
      host: process.env.SIEM_SYSLOG_HOST ?? "",
      port: parseInt(process.env.SIEM_SYSLOG_PORT ?? "514", 10),
    },
    http: {
      url: process.env.SIEM_HTTP_URL ?? "",
      authHeaderSet: !!process.env.SIEM_HTTP_AUTH_HEADER,
      authHeaderMasked: maskToken(process.env.SIEM_HTTP_AUTH_HEADER),
    },
  };
}

function maskToken(s: string | undefined | null): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= 6) return "***";
  return trimmed.slice(0, 3) + "***" + trimmed.slice(-3);
}

/**
 * Create the PENDING ledger row and fire a delivery attempt in the
 * background.  Returns the ledger row id (or null if SIEM is disabled).
 *
 * Never throws — failures are logged and swallowed because the audit
 * pipeline must not depend on the shipper.
 */
export async function enqueueAuditShipment(auditLogId: string): Promise<string | null> {
  const target = getTarget();
  if (!target) return null;
  try {
    const row = await db.siemShipLog.create({
      data: { auditLogId, target, status: "PENDING" },
      select: { id: true },
    });
    // Fire-and-forget — never block the audit write.
    void shipAuditEvent(auditLogId).catch((err) => {
      logger.error("siem: background ship failed", err, { auditLogId });
    });
    return row.id;
  } catch (error) {
    logger.error("siem: failed to enqueue shipment", error, { auditLogId });
    return null;
  }
}

/**
 * Attempt to deliver a single AuditLog row to the configured target.
 * Updates the most recent SiemShipLog for the audit row (creates one
 * if missing — covers admin-triggered manual retries / re-queues).
 */
export async function shipAuditEvent(
  auditLogId: string
): Promise<{ ok: boolean; error?: string }> {
  const target = getTarget();
  if (!target) return { ok: false, error: "SIEM target not configured" };

  const audit = await db.auditLog.findUnique({ where: { id: auditLogId } });
  if (!audit) return { ok: false, error: "AuditLog row not found" };

  // Find (or create) the ledger row to update.
  let ledger = await db.siemShipLog.findFirst({
    where: { auditLogId, status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!ledger) {
    ledger = await db.siemShipLog.create({
      data: { auditLogId, target, status: "PENDING" },
    });
  }

  const result = await deliver(target, audit);

  if (result.ok) {
    await db.siemShipLog.update({
      where: { id: ledger.id },
      data: {
        status: "DELIVERED",
        attempts: { increment: 1 },
        deliveredAt: new Date(),
        lastError: null,
      },
    });
    return { ok: true };
  }

  const nextAttempts = ledger.attempts + 1;
  const exhausted = nextAttempts >= MAX_ATTEMPTS;
  await db.siemShipLog.update({
    where: { id: ledger.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      attempts: { increment: 1 },
      lastError: result.error?.slice(0, 500) ?? "unknown error",
    },
  });
  return { ok: false, error: result.error };
}

/**
 * Sweep PENDING (and not-yet-exhausted FAILED) rows and try to deliver
 * them.  Caller chooses the batch size — the worker keeps it small so a
 * burst of failures can't monopolise the event loop.
 */
export async function retryFailedShipments(
  maxBatch = 50
): Promise<{ delivered: number; failed: number }> {
  if (!siemEnabled()) return { delivered: 0, failed: 0 };

  const candidates = await db.siemShipLog.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: maxBatch,
    select: { id: true, auditLogId: true },
  });

  let delivered = 0;
  let failed = 0;
  for (const row of candidates) {
    const r = await shipAuditEvent(row.auditLogId);
    if (r.ok) delivered += 1;
    else failed += 1;
  }
  return { delivered, failed };
}

// ---------------------------------------------------------------------------
// Transport-specific delivery.
// ---------------------------------------------------------------------------

interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  occurredAt: Date;
  prevHash: string | null;
  hash: string | null;
}

async function deliver(
  target: SiemTarget,
  row: AuditRow
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (target === "splunk_hec") return await deliverSplunkHec(row);
    if (target === "syslog_udp") return await deliverSyslogUdp(row);
    return await deliverHttpJson(row);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverSplunkHec(
  row: AuditRow
): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SIEM_SPLUNK_URL;
  const token = process.env.SIEM_SPLUNK_TOKEN;
  if (!url || !token) {
    return { ok: false, error: "SIEM_SPLUNK_URL / SIEM_SPLUNK_TOKEN unset" };
  }
  const payload = {
    event: serialiseRow(row),
    sourcetype: "edrms_audit",
    time: row.occurredAt.getTime() / 1000,
  };
  const res = await httpPost(url, JSON.stringify(payload), {
    "Content-Type": "application/json",
    Authorization: `Splunk ${token}`,
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
}

async function deliverHttpJson(
  row: AuditRow
): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SIEM_HTTP_URL;
  if (!url) return { ok: false, error: "SIEM_HTTP_URL unset" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authHeader = process.env.SIEM_HTTP_AUTH_HEADER;
  if (authHeader) headers["Authorization"] = authHeader;
  const res = await httpPost(url, JSON.stringify(serialiseRow(row)), headers);
  if (res.ok) return { ok: true };
  return { ok: false, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
}

async function deliverSyslogUdp(
  row: AuditRow
): Promise<{ ok: boolean; error?: string }> {
  const host = process.env.SIEM_SYSLOG_HOST;
  const port = parseInt(process.env.SIEM_SYSLOG_PORT ?? "514", 10);
  if (!host) return { ok: false, error: "SIEM_SYSLOG_HOST unset" };
  const line = buildSyslogLine(row);
  return await new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const buf = Buffer.from(line, "utf8");
    socket.send(buf, 0, buf.length, port, host, (err) => {
      socket.close();
      if (err) {
        resolve({ ok: false, error: err.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

/**
 * Build an RFC 5424 syslog line.
 *
 *   <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
 *
 * PRI = facility (1 = user) * 8 + severity (6 = informational) = 14.
 */
function buildSyslogLine(row: AuditRow): string {
  const pri = 14;
  const version = 1;
  const timestamp = row.occurredAt.toISOString();
  const hostname = sanitise(os.hostname()) || "-";
  const appName = "edrms";
  const procId = String(process.pid);
  const msgId = sanitise(row.action) || "-";
  const sd = "-";
  const msg = JSON.stringify(serialiseRow(row));
  return `<${pri}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${sd} ${msg}`;
}

function sanitise(s: string): string {
  return s.replace(/[^\x21-\x7e]/g, "");
}

function serialiseRow(row: AuditRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata ?? {},
    occurredAt: row.occurredAt.toISOString(),
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/**
 * Minimal POST helper using the global `fetch` (Node 18+). Includes an
 * AbortController-driven timeout because SIEM endpoints can hang.
 */
async function httpPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a synthetic audit event end-to-end (writes a real audit row,
 * enqueues + delivers).  Used by the admin "Test shipment" button.
 */
export async function sendTestShipment(userId?: string): Promise<{
  ok: boolean;
  auditLogId?: string;
  error?: string;
}> {
  if (!siemEnabled()) return { ok: false, error: "SIEM not configured" };
  // Import lazily to avoid circular imports at module-load time.
  const { writeAudit } = await import("@/lib/audit");
  await writeAudit({
    userId,
    action: "siem.test_shipment",
    resourceType: "siem",
    metadata: { synthetic: true, at: new Date().toISOString() },
  });
  // Find the row we just wrote (newest synthetic event for this user).
  const row = await db.auditLog.findFirst({
    where: { action: "siem.test_shipment", userId: userId ?? null },
    orderBy: { occurredAt: "desc" },
  });
  if (!row) return { ok: false, error: "Test audit row not persisted" };
  const r = await shipAuditEvent(row.id);
  return { ok: r.ok, auditLogId: row.id, error: r.error };
}

export const SIEM_MAX_ATTEMPTS = MAX_ATTEMPTS;
