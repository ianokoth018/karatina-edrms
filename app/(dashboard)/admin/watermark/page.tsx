"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const CLASSIFICATIONS = [
  "OPEN",
  "CONFIDENTIAL",
  "RESTRICTED",
  "SECRET",
  "TOP_SECRET",
] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

interface WatermarkConfig {
  enabled: boolean;
  minClassification: Classification;
  text: string;
}

export default function WatermarkSettingsPage() {
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

  const [enabled, setEnabled] = useState(false);
  const [minClassification, setMinClassification] =
    useState<Classification>("CONFIDENTIAL");
  const [text, setText] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/watermark");
        if (!res.ok) return;
        const cfg = (await res.json()) as WatermarkConfig;
        if (cancelled) return;
        setEnabled(!!cfg.enabled);
        setMinClassification(cfg.minClassification ?? "CONFIDENTIAL");
        setText(cfg.text ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/watermark", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, minClassification, text }),
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Settings saved." });
      } else {
        const err = await res.json().catch(() => null);
        setMsg({ kind: "err", text: err?.error ?? "Save failed" });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error" });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          View-time Watermarking
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Stamp served PDFs with the viewer&apos;s name and a timestamp to deter
          screenshots and unauthorised redistribution.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Enforcement
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-xl">
              When enabled, any served PDF whose document classification is at
              or above the threshold below is automatically watermarked. Users
              can still force watermarking on lower-classification documents
              with the existing <code>?watermark=1</code> query flag.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={loading}
              className="w-4 h-4 rounded border-gray-300 text-[#02773b] focus:ring-[#02773b]/30"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Enable watermarking
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Minimum classification
            </label>
            <select
              value={minClassification}
              onChange={(e) =>
                setMinClassification(e.target.value as Classification)
              }
              disabled={loading || !enabled}
              className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none disabled:opacity-50"
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Documents at this level or higher are auto-watermarked.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Watermark text (optional)
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="{{userName}} · {{timestamp}}"
              disabled={loading || !enabled}
              className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Tokens: <code>{"{{userName}}"}</code>,{" "}
              <code>{"{{timestamp}}"}</code>, <code>{"{{label}}"}</code>. Leave
              blank to use the default (viewer name + timestamp).
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 px-4 py-3 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          <strong className="text-gray-800 dark:text-gray-200">
            What gets watermarked.
          </strong>{" "}
          Only PDF responses from <code>/api/files</code> are stamped. Native
          (non-PDF) files and the encrypted bytes on disk are never modified —
          the watermark is applied on the fly per request, so each viewer sees
          their own name. When watermarking is disabled, the
          <code> ?watermark=1 </code>query flag is ignored entirely.
        </div>

        <div className="flex items-center justify-end gap-3">
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
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
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
