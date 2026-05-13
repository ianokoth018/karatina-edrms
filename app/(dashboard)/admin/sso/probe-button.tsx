"use client";

import { useState } from "react";

interface ProbeOk {
  ok: true;
  issuer: string;
  endpoints: {
    authorization_endpoint: string | null;
    token_endpoint: string | null;
    userinfo_endpoint: string | null;
    jwks_uri: string | null;
    end_session_endpoint: string | null;
  };
}

interface ProbeErr {
  ok: false;
  error: string;
}

type ProbeResult = ProbeOk | ProbeErr;

export function SsoProbeButton({ disabled }: { disabled?: boolean }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function runProbe() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sso/probe", { method: "GET" });
      const data = (await res.json()) as ProbeResult;
      setResult(data);
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={runProbe}
        disabled={running || disabled}
        className="rounded-md bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50"
      >
        {running ? "Testing…" : "Test connection"}
      </button>

      {result && result.ok && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          <div className="font-semibold mb-1">Discovery succeeded</div>
          <div className="text-xs">
            Issuer: <span className="font-mono">{result.issuer}</span>
          </div>
          <ul className="mt-2 text-xs space-y-0.5">
            {Object.entries(result.endpoints).map(([k, v]) => (
              <li key={k} className="font-mono">
                <span className="text-green-700">{k}</span>:{" "}
                <span className="text-gray-700">{v ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold mb-1">Discovery failed</div>
          <div className="text-xs break-all">{result.error}</div>
        </div>
      )}
    </div>
  );
}
