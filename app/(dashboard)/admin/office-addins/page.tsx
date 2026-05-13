"use client";

/**
 * Admin → Office Add-ins.
 *
 * Lists the four Office Add-in manifest URLs (Word/Excel/PowerPoint/Outlook)
 * with copy-to-clipboard buttons and a "download with this host baked in"
 * helper. Sideload tips live inline next to each entry.
 *
 * Auth: admin-only. Renders nothing useful for users without `admin:manage`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

interface AddinEntry {
  key: "word" | "excel" | "powerpoint" | "outlook";
  label: string;
  file: string;
  tip: string;
}

const ADDINS: AddinEntry[] = [
  {
    key: "word",
    label: "Word",
    file: "manifest-word.xml",
    tip: "Word → Insert → Get Add-ins → My Add-ins → Upload My Add-in.",
  },
  {
    key: "excel",
    label: "Excel",
    file: "manifest-excel.xml",
    tip: "Excel → Insert → Get Add-ins → My Add-ins → Upload My Add-in.",
  },
  {
    key: "powerpoint",
    label: "PowerPoint",
    file: "manifest-powerpoint.xml",
    tip: "PowerPoint → Insert → Get Add-ins → My Add-ins → Upload My Add-in.",
  },
  {
    key: "outlook",
    label: "Outlook",
    file: "manifest-outlook.xml",
    tip: "Outlook → Get Add-ins (gear menu) → My add-ins → Add a custom add-in → From file.",
  },
];

export default function OfficeAddinsAdminPage() {
  const { data: session, status } = useSession();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const isAdmin = useMemo(
    () => (session?.user?.permissions ?? []).includes("admin:manage"),
    [session]
  );

  const onCopy = useCallback(async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard blocked — surface nothing rather than crash */
    }
  }, []);

  /**
   * Fetch the static manifest template, substitute `EDRMS_HOST` with the
   * actual deploy origin, and trigger a browser download. Keeps the static
   * files portable while still giving admins a one-click sideload artefact.
   */
  const onDownload = useCallback(
    async (entry: AddinEntry) => {
      try {
        const tmpl = await fetch(`/office-addin/${entry.file}`).then((r) => r.text());
        const hostOnly = origin.replace(/^https?:\/\//, "");
        const xml = tmpl
          .replace(/https:\/\/EDRMS_HOST/g, origin)
          .replace(/EDRMS_HOST/g, hostOnly);
        const blob = new Blob([xml], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = entry.file;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        alert("Failed to prepare manifest download.");
      }
    },
    [origin]
  );

  if (status === "loading") {
    return <div className="p-6 text-gray-600">Loading…</div>;
  }

  if (!session?.user) {
    return <div className="p-6 text-red-600">Please sign in.</div>;
  }

  if (!isAdmin) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Microsoft Office Add-ins</h1>
        <p className="text-sm text-gray-600 mt-1">
          Sideload these manifests in Word, Excel, PowerPoint or Outlook so
          users can click <em>Save to EDRMS</em> from inside Office. Once
          tested, deploy them organisation-wide via the Microsoft 365 admin
          centre&apos;s Centralized Deployment.
        </p>
      </div>

      <div className="space-y-4">
        {ADDINS.map((entry) => {
          const url = `${origin}/office-addin/${entry.file}`;
          return (
            <section
              key={entry.key}
              className="rounded-lg border border-gray-200 bg-white p-4 space-y-2"
            >
              <header className="flex items-center justify-between">
                <h2 className="font-medium">{entry.label}</h2>
                <span className="text-xs text-gray-500">manifest</span>
              </header>

              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-800">
                  {url || `${entry.file}`}
                </code>
                <button
                  type="button"
                  onClick={() => onCopy(url, entry.key)}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {copied === entry.key ? "Copied!" : "Copy URL"}
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(entry)}
                  className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Download
                </button>
              </div>

              <p className="text-xs text-gray-600">{entry.tip}</p>
            </section>
          );
        })}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <h2 className="font-medium mb-1">Production rollout</h2>
        <p>
          For organisation-wide deployment, paste any manifest URL into the
          Microsoft 365 admin centre under{" "}
          <span className="font-medium">
            Settings → Integrated apps → Upload custom apps → Office Add-in
          </span>
          . Centralized Deployment pushes the add-in to assigned users within
          about 24 hours.
        </p>
      </div>
    </div>
  );
}
