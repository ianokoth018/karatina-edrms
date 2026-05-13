"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ProviderState = "unknown" | "enabled" | "disabled";

interface ProviderCard {
  id: "docusign" | "nitro";
  name: string;
  href: string;
  statusEndpoint: string;
  blurb: string;
}

const PROVIDERS: ProviderCard[] = [
  {
    id: "docusign",
    name: "DocuSign",
    href: "/admin/integrations/docusign",
    statusEndpoint: "/api/docusign/status",
    blurb:
      "JWT Grant + impersonation. Requires an RSA keypair on the integration and one-time consent.",
  },
  {
    id: "nitro",
    name: "Nitro PDF",
    href: "/admin/integrations/nitro",
    statusEndpoint: "/api/nitro/status",
    blurb:
      "OAuth2 client-credentials. Simpler setup — just paste a client ID + secret.",
  },
];

export default function SignatureIntegrationsHub() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [states, setStates] = useState<Record<string, ProviderState>>({
    docusign: "unknown",
    nitro: "unknown",
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    Promise.all(
      PROVIDERS.map(async (p) => {
        try {
          const res = await fetch(p.statusEndpoint);
          if (!res.ok) return [p.id, "disabled"] as const;
          const data = await res.json().catch(() => null);
          return [p.id, data?.enabled ? "enabled" : "disabled"] as const;
        } catch {
          return [p.id, "disabled"] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setStates(Object.fromEntries(entries) as Record<string, ProviderState>);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Signature Integration
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Configure one or both cryptographic signing providers. Memo
          initiators pick which to use at compose time when more than one
          is enabled.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((p) => {
          const state = states[p.id];
          return (
            <Link
              key={p.id}
              href={p.href}
              className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md hover:border-[#02773b]/40 transition-all p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-[#02773b]/10 flex items-center justify-center shrink-0">
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
                        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {p.name}
                    </h2>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                      {p.blurb}
                    </p>
                  </div>
                </div>
                <StatusPill state={state} />
              </div>

              <div className="flex items-center justify-end mt-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#02773b] group-hover:gap-2 transition-all">
                  Configure
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                    />
                  </svg>
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <Link
        href="/dashboard"
        className="inline-block text-xs text-[#02773b] dark:text-[#60c988] hover:underline"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}

function StatusPill({ state }: { state: ProviderState }) {
  if (state === "enabled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Enabled
      </span>
    );
  }
  if (state === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-50 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 animate-pulse" />
      Checking…
    </span>
  );
}
