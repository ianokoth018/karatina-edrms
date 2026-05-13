"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Branding {
  orgName: string;
  orgShortName: string;
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  faviconUrl?: string;
  footerText?: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function BrandingSettingsPage() {
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
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const [orgName, setOrgName] = useState("");
  const [orgShortName, setOrgShortName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#02773b");
  const [accentColor, setAccentColor] = useState("#dd9f42");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [footerText, setFooterText] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/branding");
        if (!res.ok) return;
        const b = (await res.json()) as Branding;
        if (cancelled) return;
        setOrgName(b.orgName ?? "");
        setOrgShortName(b.orgShortName ?? "");
        setPrimaryColor(b.primaryColor ?? "#02773b");
        setAccentColor(b.accentColor ?? "#dd9f42");
        setLogoUrl(b.logoUrl ?? "");
        setFaviconUrl(b.faviconUrl ?? "");
        setFooterText(b.footerText ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  function colorValid(c: string): boolean {
    return HEX_RE.test(c);
  }

  async function handleSave() {
    if (!colorValid(primaryColor) || !colorValid(accentColor)) {
      setMsg({
        kind: "err",
        text: "Colours must be 6-digit hex (e.g. #02773b)",
      });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          orgShortName: orgShortName.trim().slice(0, 16),
          primaryColor,
          accentColor,
          logoUrl: logoUrl.trim(),
          faviconUrl: faviconUrl.trim(),
          footerText: footerText.trim(),
        }),
      });
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: "Saved. Reload any page to see the new theme.",
        });
      } else {
        const err = await res.json().catch(() => null);
        setMsg({ kind: "err", text: err?.error ?? "Save failed" });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error" });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 6000);
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Branding & Theme
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Customise the organisation name, brand colours, and logo. Changes
          apply on the next page load (the layout is server-rendered).
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-6">
        {/* Organisation */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Organisation
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Full name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={loading}
                placeholder="Karatina University"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Shown in page titles and the document &lt;title&gt; tag.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Short name (≤ 16 chars)
              </label>
              <input
                type="text"
                value={orgShortName}
                onChange={(e) => setOrgShortName(e.target.value.slice(0, 16))}
                disabled={loading}
                maxLength={16}
                placeholder="Karatina"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Used in tight UI like the sidebar.
              </p>
            </div>
          </div>
        </section>

        {/* Colours */}
        <section className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Brand colours
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Primary
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  disabled={loading}
                  className="h-10 w-14 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50"
                  aria-label="Primary colour picker"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  disabled={loading}
                  className="flex-1 h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
                />
                <span
                  aria-hidden
                  className="h-10 w-10 rounded-lg border border-gray-200 dark:border-gray-700"
                  style={{ background: primaryColor }}
                />
              </div>
              {!colorValid(primaryColor) && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Must be a 6-digit hex value.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Accent
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  disabled={loading}
                  className="h-10 w-14 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer disabled:opacity-50"
                  aria-label="Accent colour picker"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  disabled={loading}
                  className="flex-1 h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
                />
                <span
                  aria-hidden
                  className="h-10 w-10 rounded-lg border border-gray-200 dark:border-gray-700"
                  style={{ background: accentColor }}
                />
              </div>
              {!colorValid(accentColor) && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Must be a 6-digit hex value.
                </p>
              )}
            </div>
          </div>

          {/* Live preview swatch */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="flex">
              <div
                className="flex-1 px-4 py-6 text-white text-sm font-medium"
                style={{ background: primaryColor }}
              >
                Primary — {primaryColor}
              </div>
              <div
                className="flex-1 px-4 py-6 text-white text-sm font-medium"
                style={{ background: accentColor }}
              >
                Accent — {accentColor}
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/40 px-4 py-3 flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
              <span>Preview button:</span>
              <button
                type="button"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-lg text-white text-xs font-medium"
                style={{ background: primaryColor }}
              >
                Primary action
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-lg text-white text-xs font-medium"
                style={{ background: accentColor }}
              >
                Accent badge
              </button>
            </div>
          </div>
        </section>

        {/* Assets */}
        <section className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Assets
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Logo URL
              </label>
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={loading}
                placeholder="/karu-logo-v2.png or https://…"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Favicon URL
              </label>
              <input
                type="text"
                value={faviconUrl}
                onChange={(e) => setFaviconUrl(e.target.value)}
                disabled={loading}
                placeholder="/favicon.ico or https://…"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Footer text
            </label>
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              disabled={loading}
              placeholder="© 2026 Karatina University. All rights reserved."
              className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none disabled:opacity-50"
            />
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 dark:border-gray-800 pt-6">
          {msg && (
            <span
              className={`text-xs font-medium ${
                msg.kind === "ok"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {msg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-white text-sm font-medium disabled:opacity-50"
            style={{ background: primaryColor }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <Link
        href="/dashboard"
        className="text-xs hover:underline"
        style={{ color: primaryColor }}
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}
