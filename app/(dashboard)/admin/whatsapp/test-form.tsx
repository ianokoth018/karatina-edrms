"use client";

import { useState } from "react";

interface Props {
  disabled?: boolean;
}

export default function WhatsAppTestForm({ disabled }: Props) {
  const [mode, setMode] = useState<"text" | "template">("text");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("en");
  const [templateVars, setTemplateVars] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSend() {
    if (!phone) return;
    setBusy(true);
    setResult(null);
    try {
      const body =
        mode === "template"
          ? {
              phone,
              templateName,
              templateLang,
              templateVariables: templateVars
                .split(/[\n,]/)
                .map((v) => v.trim())
                .filter(Boolean),
            }
          : { phone, message };

      const res = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; id?: string; error?: string }
        | null;

      if (json?.ok) {
        setResult({ ok: true, text: `Sent. Message id: ${json.id ?? "(unknown)"}` });
      } else {
        setResult({ ok: false, text: json?.error ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        {(["text", "template"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 ${
              mode === m
                ? "bg-[#02773b] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {m === "text" ? "Free text" : "Template"}
          </button>
        ))}
      </div>

      <label className="block text-sm">
        <span className="text-gray-700">Recipient phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+254712345678"
          className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-[#02773b] focus:outline-none"
        />
      </label>

      {mode === "text" ? (
        <label className="block text-sm">
          <span className="text-gray-700">Message body</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Hello from EDRMS"
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-[#02773b] focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            Free text requires an active 24-hour session window (the user must have
            messaged us recently). For first-touch alerts use a template.
          </span>
        </label>
      ) : (
        <>
          <label className="block text-sm">
            <span className="text-gray-700">Template name</span>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="edrms_task_assignment"
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-[#02773b] focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Language</span>
            <input
              type="text"
              value={templateLang}
              onChange={(e) => setTemplateLang(e.target.value)}
              placeholder="en"
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-[#02773b] focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Body variables (one per line)</span>
            <textarea
              value={templateVars}
              onChange={(e) => setTemplateVars(e.target.value)}
              rows={3}
              placeholder={"Alice\nReview Memo #1234\n2 hours"}
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-[#02773b] focus:outline-none"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Substituted for <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… in the
              approved template body, in order.
            </span>
          </label>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || busy || !phone}
          onClick={handleSend}
          className="rounded-md bg-[#02773b] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {busy ? "Sending…" : "Send test"}
        </button>
        {result && (
          <span
            className={`text-sm ${
              result.ok ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
