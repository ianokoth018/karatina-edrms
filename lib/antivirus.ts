import net from "net";
import { promises as fs } from "fs";
import { logger } from "@/lib/logger";

/**
 * ClamAV on-ingest scanner — speaks the clamd INSTREAM protocol directly so
 * we don't take on an extra npm dep. A clamd daemon is expected at
 * CLAMAV_HOST:CLAMAV_PORT (default 127.0.0.1:3310).
 *
 * Environment:
 *   CLAMAV_ENABLED       "true" to scan; anything else short-circuits clean.
 *                        Disabled by default so dev/CI without clamd doesn't
 *                        block uploads.
 *   CLAMAV_HOST          host of the clamd daemon (default 127.0.0.1)
 *   CLAMAV_PORT          tcp port (default 3310)
 *   CLAMAV_TIMEOUT_MS    per-scan socket timeout in ms (default 30000)
 *   CLAMAV_MAX_BYTES     soft cap on bytes to send; larger files are flagged
 *                        SKIPPED (default 100 MB — clamd's own StreamMaxLength
 *                        is the hard limit, typically 25 MB by default; raise
 *                        on both sides if you need larger).
 *   CLAMAV_FAIL_MODE     "open" or "closed" — what to do when the scanner is
 *                        unreachable, errors out, or times out.
 *                        "closed" (default) rejects the upload.
 *                        "open" accepts it with a logged warning.
 *
 * `scanBuffer` / `scanFile` always return; callers decide based on the
 * `clean` field. `quarantined` is true when something tripped a signature.
 */

export type ScanResult =
  | { clean: true; scanned: true; durationMs: number }
  | { clean: true; scanned: false; reason: "DISABLED" | "TOO_LARGE"; durationMs: number }
  | { clean: false; scanned: true; signature: string; durationMs: number }
  | { clean: false; scanned: false; reason: "UNREACHABLE" | "TIMEOUT" | "ERROR"; error: string; durationMs: number };

function envEnabled(): boolean {
  const v = process.env.CLAMAV_ENABLED;
  return v === "1" || v === "true" || v === "TRUE";
}

function envHost() {
  return process.env.CLAMAV_HOST || "127.0.0.1";
}
function envPort() {
  const n = parseInt(process.env.CLAMAV_PORT || "3310", 10);
  return Number.isFinite(n) ? n : 3310;
}
function envTimeout() {
  const n = parseInt(process.env.CLAMAV_TIMEOUT_MS || "30000", 10);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}
function envMaxBytes() {
  const n = parseInt(process.env.CLAMAV_MAX_BYTES || `${100 * 1024 * 1024}`, 10);
  return Number.isFinite(n) && n > 0 ? n : 100 * 1024 * 1024;
}
export function antivirusFailMode(): "open" | "closed" {
  return process.env.CLAMAV_FAIL_MODE === "open" ? "open" : "closed";
}

export function antivirusEnabled(): boolean {
  return envEnabled();
}

/**
 * Convert a non-clean ScanResult to whether the upload should be rejected,
 * honouring CLAMAV_FAIL_MODE. Used by callers that don't care about the
 * specific reason — they just want a bool.
 */
export function shouldRejectIngest(result: ScanResult): boolean {
  if (result.clean) return false;
  if (result.scanned) return true; // signature hit — always reject
  // Not scanned (unreachable/timeout/error): respect fail mode
  return antivirusFailMode() === "closed";
}

/**
 * Scan an in-memory buffer using clamd INSTREAM.
 */
export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const started = Date.now();
  if (!envEnabled()) {
    return { clean: true, scanned: false, reason: "DISABLED", durationMs: 0 };
  }
  const maxBytes = envMaxBytes();
  if (buffer.length > maxBytes) {
    return {
      clean: true,
      scanned: false,
      reason: "TOO_LARGE",
      durationMs: Date.now() - started,
    };
  }
  return runInstream(buffer, started);
}

/**
 * Scan a file on disk. Reads it once and pipes the bytes to clamd; works for
 * the hot-folder and tus paths where the file is already on the local fs.
 */
export async function scanFile(filePath: string): Promise<ScanResult> {
  const started = Date.now();
  if (!envEnabled()) {
    return { clean: true, scanned: false, reason: "DISABLED", durationMs: 0 };
  }
  let buf: Buffer;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > envMaxBytes()) {
      return {
        clean: true,
        scanned: false,
        reason: "TOO_LARGE",
        durationMs: Date.now() - started,
      };
    }
    buf = await fs.readFile(filePath);
  } catch (err) {
    return {
      clean: false,
      scanned: false,
      reason: "ERROR",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
  return runInstream(buf, started);
}

// ---------------------------------------------------------------------------
// clamd INSTREAM wire protocol
//   client: zINSTREAM\0  (z prefix = null-terminated reply)
//   client: <BE32 length><chunk> ... <BE32 0>
//   server: "stream: OK\0"  or  "stream: <Signature> FOUND\0"
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 64 * 1024;

function runInstream(buffer: Buffer, started: number): Promise<ScanResult> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: envHost(), port: envPort() });
    const timeoutMs = envTimeout();
    let response = Buffer.alloc(0);
    let settled = false;

    const finish = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    sock.setTimeout(timeoutMs);

    sock.on("timeout", () => {
      logger.warn("ClamAV scan timed out", { timeoutMs });
      finish({
        clean: false,
        scanned: false,
        reason: "TIMEOUT",
        error: `clamd no response within ${timeoutMs}ms`,
        durationMs: Date.now() - started,
      });
    });

    sock.on("error", (err) => {
      logger.warn("ClamAV scan socket error", {
        err: err instanceof Error ? err.message : String(err),
      });
      finish({
        clean: false,
        scanned: false,
        reason: "UNREACHABLE",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    });

    sock.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.includes(0)) {
        const line = response
          .slice(0, response.indexOf(0))
          .toString("utf8")
          .trim();
        const durationMs = Date.now() - started;
        if (/\bOK$/i.test(line)) {
          finish({ clean: true, scanned: true, durationMs });
        } else if (/\bFOUND$/i.test(line)) {
          // Format: "stream: <Signature> FOUND"
          const m = /:\s*(.+?)\s+FOUND$/i.exec(line);
          const signature = m?.[1] ?? "UNKNOWN";
          finish({ clean: false, scanned: true, signature, durationMs });
        } else if (/ERROR$/i.test(line)) {
          finish({
            clean: false,
            scanned: false,
            reason: "ERROR",
            error: line,
            durationMs,
          });
        } else {
          finish({
            clean: false,
            scanned: false,
            reason: "ERROR",
            error: `Unrecognised clamd reply: ${line}`,
            durationMs,
          });
        }
      }
    });

    sock.on("connect", () => {
      try {
        sock.write("zINSTREAM\0");
        for (let off = 0; off < buffer.length; off += CHUNK_SIZE) {
          const chunk = buffer.subarray(off, Math.min(off + CHUNK_SIZE, buffer.length));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          sock.write(len);
          sock.write(chunk);
        }
        // Zero-length frame = end of stream
        const term = Buffer.alloc(4);
        term.writeUInt32BE(0, 0);
        sock.write(term);
      } catch (err) {
        finish({
          clean: false,
          scanned: false,
          reason: "ERROR",
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
      }
    });
  });
}

/**
 * Human-readable summary for logs / audit metadata.
 */
export function describeScanResult(r: ScanResult): string {
  if (r.clean && r.scanned) return `clean (${r.durationMs}ms)`;
  if (r.clean && !r.scanned) return `skipped: ${r.reason}`;
  if (!r.clean && r.scanned) return `INFECTED: ${r.signature}`;
  return `scan-failed: ${r.reason} (${r.error})`;
}
