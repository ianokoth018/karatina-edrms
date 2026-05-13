"use client";

import { useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface VerifyResult {
  ok: boolean;
  total: number;
  badCount: number;
  unhashedCount: number;
  firstBadId?: string;
}

export default function AuditIntegrityPage() {
  const { can, ready } = usePermissions();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }
  if (!can("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  async function runVerify() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/audit-integrity/verify", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as VerifyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-2">Audit log integrity</h1>
      <p className="text-sm text-gray-600 mb-6">
        Recomputes the SHA-256 hash chain across every audit log row and
        reports any row whose hash no longer matches its contents. A clean
        run means no row has been altered or deleted since it was written.
      </p>

      <button
        type="button"
        onClick={runVerify}
        disabled={running}
        className="rounded-md bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50"
      >
        {running ? "Verifying…" : "Verify integrity"}
      </button>

      {error && (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div
            className={`rounded-md border p-4 ${
              result.ok
                ? "border-green-300 bg-green-50 text-green-900"
                : "border-red-300 bg-red-50 text-red-900"
            }`}
          >
            <div className="text-lg font-semibold">
              {result.ok ? "Chain intact" : "Chain broken"}
            </div>
            <div className="text-sm mt-1">
              {result.ok
                ? "All hashed audit rows verified."
                : `${result.badCount} row${
                    result.badCount === 1 ? "" : "s"
                  } failed verification.`}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border border-gray-200 p-3">
              <dt className="text-gray-500">Total rows</dt>
              <dd className="text-2xl font-mono">{result.total}</dd>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <dt className="text-gray-500">Mismatched</dt>
              <dd className="text-2xl font-mono text-red-700">
                {result.badCount}
              </dd>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <dt className="text-gray-500">Unhashed (legacy)</dt>
              <dd className="text-2xl font-mono text-amber-700">
                {result.unhashedCount}
              </dd>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <dt className="text-gray-500">First bad row</dt>
              <dd className="font-mono text-xs break-all">
                {result.firstBadId ?? "—"}
              </dd>
            </div>
          </dl>

          {result.unhashedCount > 0 && (
            <div className="text-xs text-gray-600">
              Run{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">
                npx tsx scripts/audit-backfill-hashes.ts
              </code>{" "}
              to seed hashes onto legacy rows written before this feature
              shipped.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
