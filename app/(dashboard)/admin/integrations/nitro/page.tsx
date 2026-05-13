"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SafeConfig {
  clientId: string;
  environment: "sandbox" | "production";
  oauthTokenUrl: string;
  apiBaseUrl: string;
  enabled: boolean;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  source: "database" | "none";
}

export default function NitroSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasClientSecret, setHasClientSecret] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [environment, setEnvironment] = useState<"sandbox" | "production">(
    "sandbox",
  );
  const [oauthTokenUrl, setOauthTokenUrl] = useState(
    "https://api.sandbox.gonitro.com/oauth/token",
  );
  const [apiBaseUrl, setApiBaseUrl] = useState(
    "https://api.sandbox.gonitro.com/sign/v2",
  );
  const [enabled, setEnabled] = useState(false);
  const [source, setSource] = useState<"database" | "none">("none");

  const [connection, setConnection] = useState<
    | { state: "unknown" }
    | { state: "ok"; accountName: string | null }
    | { state: "fail"; error: string }
  >({ state: "unknown" });

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/nitro");
        if (!res.ok) return;
        const cfg = (await res.json()) as SafeConfig;
        if (cancelled) return;
        setClientId(cfg.clientId);
        setEnvironment(cfg.environment);
        setOauthTokenUrl(cfg.oauthTokenUrl);
        setApiBaseUrl(cfg.apiBaseUrl);
        setEnabled(cfg.enabled);
        setHasClientSecret(cfg.hasClientSecret);
        setHasWebhookSecret(cfg.hasWebhookSecret);
        setSource(cfg.source);

        const fullyConfigured =
          cfg.source === "database" &&
          Boolean(cfg.clientId) &&
          cfg.hasClientSecret;

        if (!fullyConfigured) {
          setShowAdvanced(true);
        }

        if (fullyConfigured && cfg.enabled) {
          try {
            const probe = await fetch("/api/admin/settings/nitro/test", {
              method: "POST",
            });
            const data = await probe.json().catch(() => null);
            if (cancelled) return;
            if (data?.connected) {
              setConnection({
                state: "ok",
                accountName: data.accountName ?? null,
              });
            } else if (data?.error) {
              setConnection({ state: "fail", error: data.error });
            }
          } catch {
            // Silent — admin can hit "Test connection" manually.
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  function handleEnvChange(env: "sandbox" | "production") {
    setEnvironment(env);
    if (env === "production") {
      setOauthTokenUrl("https://api.gonitro.com/oauth/token");
      setApiBaseUrl("https://api.gonitro.com/sign/v2");
    } else {
      setOauthTokenUrl("https://api.sandbox.gonitro.com/oauth/token");
      setApiBaseUrl("https://api.sandbox.gonitro.com/sign/v2");
    }
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings/nitro", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          webhookSecret,
          environment,
          oauthTokenUrl,
          apiBaseUrl,
          enabled,
        }),
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Settings saved." });
        setSource("database");
        if (clientSecret) setHasClientSecret(true);
        if (webhookSecret) setHasWebhookSecret(true);
        setClientSecret("");
        setWebhookSecret("");
      } else {
        const err = await res.json().catch(() => null);
        setMsg({ kind: "err", text: err?.error ?? "Save failed" });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error" });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 5000);
  }

  async function handleTestConnection() {
    setTesting(true);
    setConnection({ state: "unknown" });
    try {
      const res = await fetch("/api/admin/settings/nitro/test", {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (data?.connected) {
        setConnection({
          state: "ok",
          accountName: data.accountName ?? null,
        });
      } else {
        setConnection({
          state: "fail",
          error: data?.error ?? "Connection failed",
        });
      }
    } catch {
      setConnection({ state: "fail", error: "Network error" });
    }
    setTesting(false);
  }

  const credentialsComplete =
    !!clientId && (hasClientSecret || !!clientSecret);

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Nitro Sign Integration
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Cryptographic memo signing via Nitro Sign — an alternative to
          DocuSign with a simpler OAuth2 client-credentials setup (no RSA
          keypair, no one-time impersonation consent).
        </p>
      </div>

      {/* Top status card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[#02773b]/10 flex items-center justify-center shrink-0">
              <svg
                className="w-6 h-6 text-[#02773b]"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Connection
                </h2>
                {!loading &&
                  (connection.state === "ok" ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                      {connection.accountName
                        ? ` to ${connection.accountName}`
                        : ""}
                    </span>
                  ) : connection.state === "fail" ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-900">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      Connection failed
                    </span>
                  ) : credentialsComplete && enabled ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Configured · not yet tested
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      Not configured
                    </span>
                  ))}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Environment: <strong className="capitalize">{environment}</strong>
                {source === "database" ? " · saved in database" : " · not saved"}
              </p>
              {connection.state === "fail" && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 break-all">
                  {connection.error}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-gray-300 text-[#02773b] focus:ring-[#02773b]/30"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enabled
              </span>
            </label>
            <button
              onClick={handleTestConnection}
              disabled={testing || !credentialsComplete || !enabled}
              title={
                !credentialsComplete
                  ? "Fill in Client ID + Client Secret first (open Advanced)"
                  : !enabled
                    ? "Toggle Enabled, save, then test"
                    : "Verify by exchanging client credentials and probing your account"
              }
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium text-[#02773b] border border-[#02773b]/30 hover:bg-[#02773b]/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <div className="w-4 h-4 border-2 border-[#02773b]/30 border-t-[#02773b] rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.7}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
              )}
              Test connection
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !clientId}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`text-xs font-medium ${
              msg.kind === "ok"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 px-4 py-3 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          <strong className="text-gray-800 dark:text-gray-200">
            How this works.
          </strong>{" "}
          Once connected, the memo&apos;s <strong>initiator</strong> sees a
          &quot;<strong>Sign with Nitro</strong>&quot; button on their memo
          to cryptographically claim ownership — just like DocuSign, but
          with the simpler Nitro auth model. The signer stays inside the
          EDRMS (Nitro&apos;s signing surface opens in an in-app modal)
          and the signed PDF + audit trail is automatically filed back
          onto the memo.
        </div>
      </div>

      {/* Advanced credentials */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="text-left">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Advanced credentials
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Client ID, Client Secret, environment, optional webhook secret
            </p>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
            />
          </svg>
        </button>

        {showAdvanced && (
          <div className="border-t border-gray-100 dark:border-gray-800 p-6 space-y-5">
            <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <p className="font-semibold">First-time setup</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Sign in to the{" "}
                  <a
                    href="https://developer.gonitro.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Nitro developer portal
                  </a>{" "}
                  (or use your production console).
                </li>
                <li>
                  Create an API app with the <strong>Sign</strong> scope and
                  copy the <strong>Client ID</strong> + <strong>Client Secret</strong>.
                </li>
                <li>
                  Choose Sandbox (testing) or Production and paste the values
                  below.
                </li>
                <li>
                  Optionally set a <strong>Webhook secret</strong> here and in
                  the Nitro Connect configuration for signed callbacks.
                </li>
                <li>Save, then click Test connection to verify.</li>
              </ol>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Environment
                </label>
                <div className="flex gap-2">
                  {(["sandbox", "production"] as const).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handleEnvChange(e)}
                      className={`flex-1 h-10 rounded-xl border text-sm font-medium capitalize transition-colors ${
                        environment === e
                          ? "border-[#02773b] bg-[#02773b]/10 text-[#02773b]"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  OAuth token URL
                </label>
                <input
                  type="text"
                  value={oauthTokenUrl}
                  onChange={(e) => setOauthTokenUrl(e.target.value)}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Sign API base URL
                </label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Client ID
                </label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Client Secret
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={
                    hasClientSecret
                      ? "(saved — paste a new value to replace)"
                      : "Paste from the Nitro developer portal"
                  }
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Encrypted at rest with AES-256-GCM. Leave blank to keep
                  the saved secret.
                </p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Webhook signing secret (optional)
                </label>
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={
                    hasWebhookSecret
                      ? "(saved — paste a new value to replace)"
                      : "Shared HMAC secret for verifying webhook callbacks"
                  }
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  If set, webhook callbacks must include a matching{" "}
                  <code>X-Nitro-Signature</code> HMAC-SHA256 header.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Webhook info */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-2 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Nitro Connect (optional webhook)
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          For instant status updates even when the signer closes their
          browser before the in-app modal redirect, configure a Nitro
          Connect webhook to POST transaction events to:
        </p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-xs font-mono break-all">
          {process.env.NEXT_PUBLIC_APP_URL ??
            process.env.APP_URL ??
            "https://your-host.example.com"}
          /api/nitro/webhook
        </code>
      </div>

      <Link
        href="/dashboard"
        className="text-xs text-[#02773b] dark:text-[#60c988] hover:underline"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}
