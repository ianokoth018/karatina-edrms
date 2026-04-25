"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SafeConfig {
  integrationKey: string;
  accountId: string;
  oauthBasePath: string;
  restBasePath: string;
  impersonationUserId: string;
  enabled: boolean;
  hasPrivateKey: boolean;
  source: "database" | "none";
}

export default function DocusignSettingsPage() {
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
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [integrationKey, setIntegrationKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [impersonationUserId, setImpersonationUserId] = useState("");
  const [environment, setEnvironment] = useState<"demo" | "production">("demo");
  const [restBasePath, setRestBasePath] = useState("https://demo.docusign.net/restapi");
  const [privateKey, setPrivateKey] = useState("");
  const [hasPrivateKey, setHasPrivateKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [source, setSource] = useState<"database" | "none">("none");

  const [connection, setConnection] = useState<
    | { state: "unknown" }
    | { state: "ok"; accountName: string | null }
    | { state: "fail"; error: string }
  >({ state: "unknown" });

  // Load saved config + auto-verify the connection silently. Without the
  // auto-verify, the green "Connected" pill is React-state-only and gets
  // wiped any time the page unmounts (tab switch, route change, refresh).
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/docusign");
        if (!res.ok) return;
        const cfg = (await res.json()) as SafeConfig;
        if (cancelled) return;
        setIntegrationKey(cfg.integrationKey);
        setAccountId(cfg.accountId);
        setImpersonationUserId(cfg.impersonationUserId);
        setEnvironment(
          cfg.oauthBasePath === "account.docusign.com" ? "production" : "demo",
        );
        setRestBasePath(cfg.restBasePath);
        setEnabled(cfg.enabled);
        setHasPrivateKey(cfg.hasPrivateKey);
        setSource(cfg.source);

        const fullyConfigured =
          cfg.source === "database" &&
          Boolean(cfg.integrationKey) &&
          Boolean(cfg.accountId) &&
          Boolean(cfg.impersonationUserId) &&
          cfg.hasPrivateKey;

        // If anything is missing, expand advanced to encourage completion.
        if (!fullyConfigured) {
          setShowAdvanced(true);
        }

        // Re-probe DocuSign so the pill reflects current connectivity, not
        // just whatever state the React tree last held.
        if (fullyConfigured) {
          try {
            const probe = await fetch("/api/admin/settings/docusign/test", {
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

  function handleEnvChange(env: "demo" | "production") {
    setEnvironment(env);
    setRestBasePath(
      env === "production"
        ? "https://www.docusign.net/restapi"
        : "https://demo.docusign.net/restapi",
    );
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings/docusign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationKey,
          accountId,
          impersonationUserId,
          oauthBasePath:
            environment === "production"
              ? "account.docusign.com"
              : "account-d.docusign.com",
          restBasePath,
          privateKey,
          enabled,
        }),
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Settings saved." });
        setSource("database");
        if (privateKey) setHasPrivateKey(true);
        setPrivateKey("");
        // Keep the last known connection state — saving the same credentials
        // doesn't invalidate the test that just passed. If the admin edited
        // credentials, they can hit "Test connection" again to re-verify.
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
      const res = await fetch("/api/admin/settings/docusign/test", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (data?.connected) {
        setConnection({ state: "ok", accountName: data.accountName ?? null });
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

  // Default the consent return-to-page to THIS settings page on the
  // current host. That URL is already a registered redirect URI in the
  // standard setup we recommend (http://localhost:3000/admin/integrations/docusign
  // for dev, https://<host>/admin/integrations/docusign for prod), so
  // there's no second "add docusign.com to redirect URIs" step.
  const consentRedirect =
    typeof window !== "undefined"
      ? `${window.location.origin}/admin/integrations/docusign`
      : "https://www.docusign.com";
  const consentUrl =
    integrationKey && impersonationUserId
      ? `https://${environment === "production" ? "account" : "account-d"}.docusign.com/oauth/auth` +
        `?response_type=code&scope=signature%20impersonation` +
        `&client_id=${encodeURIComponent(integrationKey)}` +
        `&redirect_uri=${encodeURIComponent(consentRedirect)}`
      : null;

  const credentialsComplete =
    !!integrationKey &&
    !!accountId &&
    !!impersonationUserId &&
    (hasPrivateKey || !!privateKey);

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          DocuSign Integration
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Add cryptographic memo signing alongside the in-system electronic
          signature. Signers stay inside the EDRMS — no app switching.
        </p>
      </div>

      {/* Top status card — Onboard-style "one glance" view */}
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
                      Connected{connection.accountName ? ` to ${connection.accountName}` : ""}
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
                Environment:{" "}
                <strong className="capitalize">{environment}</strong>
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
                  ? "Fill in credentials first (open Advanced)"
                  : !enabled
                    ? "Toggle Enabled, save, then test"
                    : "Verify by exchanging a JWT and probing your account"
              }
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium text-[#02773b] border border-[#02773b]/30 hover:bg-[#02773b]/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <div className="w-4 h-4 border-2 border-[#02773b]/30 border-t-[#02773b] rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              )}
              Test connection
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !integrationKey}
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

        {/* Tone-down explainer — Onboard's "no separate account, no app switching" message */}
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 px-4 py-3 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          <strong className="text-gray-800 dark:text-gray-200">How this works.</strong>{" "}
          Once connected, the memo&apos;s <strong>initiator</strong> sees a{" "}
          &quot;<strong>Sign with DocuSign</strong>&quot; button on their memo
          to cryptographically claim ownership — just like the embedded
          electronic signature, but with a verifiable digital certificate.
          The signer stays inside the EDRMS (DocuSign opens in an in-app
          modal) and the signed PDF, combined with the certificate of
          completion, is automatically filed back onto the memo.
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
              Integration key, account ID, impersonation user, RSA private key
            </p>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showAdvanced && (
          <div className="border-t border-gray-100 dark:border-gray-800 p-6 space-y-5">
            <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <p className="font-semibold">First-time setup</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Sign up at <a href="https://developers.docusign.com/" target="_blank" rel="noopener noreferrer" className="underline">developers.docusign.com</a> (or use your production account).</li>
                <li>Apps & Keys → create an integration with <strong>JWT Grant</strong> + <strong>impersonation</strong> scope.</li>
                <li>Generate an RSA keypair on the integration; paste the private key below.</li>
                <li>Copy the Integration Key, API Account ID, and the API Username (GUID) of the user the system will impersonate.</li>
                <li>Save these settings, then visit the consent URL <strong>once</strong> to grant impersonation.</li>
              </ol>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Environment
                </label>
                <div className="flex gap-2">
                  {(["demo", "production"] as const).map((e) => (
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
                  REST base path
                </label>
                <input
                  type="text"
                  value={restBasePath}
                  onChange={(e) => setRestBasePath(e.target.value)}
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Integration Key (Client ID)
                </label>
                <input
                  type="text"
                  value={integrationKey}
                  onChange={(e) => setIntegrationKey(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  API Account ID
                </label>
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Impersonation User ID (GUID)
                </label>
                <input
                  type="text"
                  value={impersonationUserId}
                  onChange={(e) => setImpersonationUserId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  RSA Private Key (PEM)
                </label>
                <textarea
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  rows={6}
                  placeholder={
                    hasPrivateKey
                      ? "(saved — paste a new key here to replace)"
                      : "-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"
                  }
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Encrypted at rest with the same AES-256-GCM key as document
                  files. Leave blank to keep the saved key.
                </p>
              </div>
            </div>

            {consentUrl && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-3">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">One-time consent required</p>
                  <p className="mt-0.5">
                    After saving, open this URL once and approve impersonation
                    so the EDRMS can sign on the configured user&apos;s behalf:
                  </p>
                  <a
                    href={consentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-1.5 text-amber-700 dark:text-amber-300 underline break-all"
                  >
                    {consentUrl}
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Webhook info */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-2 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          DocuSign Connect (optional webhook)
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          For instant status updates even when the signer closes their browser
          before the in-app modal redirect, configure a Custom Connect
          configuration in DocuSign Admin to POST envelope + recipient events to:
        </p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-xs font-mono break-all">
          {process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://your-host.example.com"}
          /api/docusign/webhook
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
