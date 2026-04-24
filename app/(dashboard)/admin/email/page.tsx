"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function EmailIntegrationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const [activeTab, setActiveTab] = useState<"settings" | "test">("settings");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Settings state
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [settingsSource, setSettingsSource] = useState<"database" | "env" | "none">("none");
  const [inboundAddress, setInboundAddress] = useState("edrms@karu.ac.ke");
  const [webhookEnabled, setWebhookEnabled] = useState(true);

  // Test email state
  const [testTo, setTestTo] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Manual inbound
  const [inFrom, setInFrom] = useState("");
  const [inSubject, setInSubject] = useState("");
  const [inBody, setInBody] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<string | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/email");
        if (!res.ok) return;
        const cfg = await res.json();
        if (cancelled) return;
        setSmtpHost(cfg.host ?? "");
        setSmtpPort(String(cfg.port ?? "587"));
        setSmtpUser(cfg.user ?? "");
        setSmtpSecure(!!cfg.secure);
        setSmtpFrom(cfg.fromAddress ?? "");
        setSmtpPass(cfg.passwordMask ?? "");
        setHasExistingPassword(!!cfg.hasPassword);
        setSettingsSource(cfg.source ?? "none");
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setIsLoadingSettings(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, status]);

  async function handleSave() {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      // If the user hasn't typed a new password and one already exists,
      // send empty so the backend keeps the saved password unchanged.
      const passwordToSend =
        smtpPass && !smtpPass.includes("•") ? smtpPass : "";
      const res = await fetch("/api/admin/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: smtpHost,
          port: Number(smtpPort),
          secure: smtpSecure,
          user: smtpUser,
          password: passwordToSend,
          fromAddress: smtpFrom,
        }),
      });
      if (res.ok) {
        setSaveMessage({ kind: "ok", text: "Settings saved." });
        setSettingsSource("database");
        if (passwordToSend) setHasExistingPassword(true);
        setSmtpPass(hasExistingPassword || passwordToSend ? "•••••••••••" : "");
      } else {
        const err = await res.json().catch(() => null);
        setSaveMessage({ kind: "err", text: err?.error ?? "Save failed" });
      }
    } catch {
      setSaveMessage({ kind: "err", text: "Network error" });
    }
    setIsSaving(false);
    setTimeout(() => setSaveMessage(null), 4000);
  }

  async function handleSendTest() {
    if (!testTo) return;
    setIsSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/settings/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      if (res.ok) {
        setSendResult({ kind: "ok", text: `Test email sent to ${testTo}.` });
      } else {
        const err = await res.json().catch(() => null);
        setSendResult({ kind: "err", text: err?.error ?? "Failed to send" });
      }
    } catch {
      setSendResult({ kind: "err", text: "Network failure" });
    }
    setIsSending(false);
  }

  async function handleRegisterInbound() {
    if (!inFrom || !inSubject) return;
    setIsRegistering(true);
    setRegisterResult(null);
    try {
      const res = await fetch("/api/email/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: inFrom,
          to: inboundAddress,
          subject: inSubject,
          textBody: inBody,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRegisterResult(`Registered as document ${data.referenceNumber}`);
        setInFrom("");
        setInSubject("");
        setInBody("");
      } else {
        const err = await res.json().catch(() => null);
        setRegisterResult(`Error: ${err?.error || "Failed to register"}`);
      }
    } catch {
      setRegisterResult("Error: Network failure");
    }
    setIsRegistering(false);
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Email Integration
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure email capture and sending for the EDRMS.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex gap-6">
          {(["settings", "test"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? "border-[#02773b] text-[#02773b]"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              {tab === "settings" ? "SMTP Settings" : "Test & Manual Entry"}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "settings" && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              SMTP Configuration
            </h2>
            {!isLoadingSettings && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                  settingsSource === "database"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900"
                    : settingsSource === "env"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {settingsSource === "database"
                  ? "Saved in database"
                  : settingsSource === "env"
                    ? "Loaded from environment (not yet saved)"
                    : "Not configured"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">SMTP Host</label>
              <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com"
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">SMTP Port</label>
              <input type="text" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587"
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">SMTP Username</label>
              <input type="text" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="edrms@karu.ac.ke"
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">SMTP Password</label>
              <input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                onFocus={(e) => {
                  // Clear the mask the moment the admin starts typing a new password
                  if (e.target.value.includes("•")) {
                    setSmtpPass("");
                  }
                }}
                placeholder={hasExistingPassword ? "Leave blank to keep current password" : "••••••••"}
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">From address</label>
              <input
                type="text"
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder='"Karatina University EDRMS" <noreply@karu.ac.ke>'
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
              />
              <p className="text-xs text-gray-400 mt-1">
                The header recipients see in their inbox. Defaults to <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">noreply@&lt;host&gt;</code> if blank.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#02773b] focus:ring-[#02773b]/30"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Use direct SSL/TLS (port 465). Leave unchecked for STARTTLS on port 587 / 25.
                </span>
              </label>
            </div>
          </div>

          <hr className="border-gray-100 dark:border-gray-800" />

          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Inbound Email
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Inbound Email Address</label>
              <input type="text" value={inboundAddress} onChange={(e) => setInboundAddress(e.target.value)}
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
              <p className="text-xs text-gray-400 mt-1">Emails sent to this address will be automatically captured as documents.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Webhook Status</label>
              <div className="flex items-center gap-3 h-10">
                <button
                  onClick={() => setWebhookEnabled(!webhookEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${webhookEnabled ? "bg-[#02773b]" : "bg-gray-300 dark:bg-gray-600"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${webhookEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className={`text-sm ${webhookEnabled ? "text-[#02773b] font-medium" : "text-gray-400"}`}>
                  {webhookEnabled ? "Active" : "Disabled"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving || isLoadingSettings || !smtpHost}
              className="h-10 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] disabled:opacity-50 transition-colors"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
            {saveMessage && (
              <span
                className={`text-sm font-medium ${
                  saveMessage.kind === "ok"
                    ? "text-[#02773b]"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {saveMessage.text}
              </span>
            )}
          </div>
        </div>
      )}

      {activeTab === "test" && (
        <div className="space-y-6">
          {/* Send test email */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Send a branded test email
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Uses the SMTP settings saved on the previous tab. The recipient
              will get a branded EDRMS template confirming the connection.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Send to</label>
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSendTest}
                disabled={isSending || !testTo}
                className="h-10 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] disabled:opacity-50 transition-colors"
              >
                {isSending ? "Sending…" : "Send test email"}
              </button>
              {sendResult && (
                <span
                  className={`text-sm font-medium ${
                    sendResult.kind === "ok"
                      ? "text-[#02773b]"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {sendResult.text}
                </span>
              )}
            </div>
          </div>

          {/* Register inbound email manually */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Register Incoming Email (Manual)
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manually register an incoming email as a document and correspondence record.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">From</label>
                <input type="text" value={inFrom} onChange={(e) => setInFrom(e.target.value)} placeholder="sender@example.com"
                  className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Subject</label>
                <input type="text" value={inSubject} onChange={(e) => setInSubject(e.target.value)} placeholder="RE: Fee Payment Inquiry"
                  className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email Body</label>
              <textarea value={inBody} onChange={(e) => setInBody(e.target.value)} rows={3}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 resize-none" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleRegisterInbound} disabled={isRegistering || !inFrom || !inSubject}
                className="h-10 px-6 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {isRegistering ? "Registering..." : "Register as Document"}
              </button>
              {registerResult && <span className="text-sm text-gray-600 dark:text-gray-400">{registerResult}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
