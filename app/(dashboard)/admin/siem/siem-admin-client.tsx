"use client";

import { useState } from "react";

interface TestResult {
  ok: boolean;
  auditLogId?: string;
  error?: string;
}

interface RetryResult {
  ok: boolean;
  requeued?: number;
  delivered?: number;
  failed?: number;
  error?: string;
}

/**
 * Client island for the SIEM admin page — owns the two action buttons
 * and renders inline result banners.  Each handler posts to its
 * corresponding admin-gated route and shows a green/red status block;
 * the parent page-refresh picks up updated counters.
 */
export function SiemAdminClient({ enabled }: { enabled: boolean }) {
  const [testing, setTesting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [retryResult, setRetryResult] = useState<RetryResult | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/siem/test", { method: "POST" });
      setTestResult((await res.json()) as TestResult);
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setTesting(false);
    }
  }

  async function runRetry() {
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await fetch("/api/admin/siem/retry", { method: "POST" });
      setRetryResult((await res.json()) as RetryResult);
    } catch (e) {
      setRetryResult({
        ok: false,
        error: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h2 className="font-medium">Actions</h2>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={runTest}
          disabled={testing || !enabled}
          className="rounded-md bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50"
        >
          {testing ? "Sending…" : "Test shipment"}
        </button>
        <button
          type="button"
          onClick={runRetry}
          disabled={retrying || !enabled}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry all failed"}
        </button>
      </div>

      {!enabled && (
        <p className="text-xs text-gray-500">
          Actions are disabled because <code>SIEM_TARGET</code> is not set.
        </p>
      )}

      {testResult && (
        <Banner
          ok={testResult.ok}
          title={testResult.ok ? "Test shipment delivered" : "Test shipment failed"}
          detail={
            testResult.ok
              ? `Audit log id: ${testResult.auditLogId ?? "(unknown)"}`
              : testResult.error ?? "Unknown error"
          }
        />
      )}

      {retryResult && (
        <Banner
          ok={retryResult.ok}
          title={retryResult.ok ? "Retry batch complete" : "Retry failed"}
          detail={
            retryResult.ok
              ? `Re-queued ${retryResult.requeued ?? 0}, delivered ${
                  retryResult.delivered ?? 0
                }, failed ${retryResult.failed ?? 0}.`
              : retryResult.error ?? "Unknown error"
          }
        />
      )}
    </section>
  );
}

function Banner({
  ok,
  title,
  detail,
}: {
  ok: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        ok
          ? "border-green-300 bg-green-50 text-green-900"
          : "border-red-300 bg-red-50 text-red-900"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs mt-1 break-all">{detail}</div>
    </div>
  );
}
