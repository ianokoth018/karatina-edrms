import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { aiEnabled } from "@/lib/ai-client";
import { getActiveProvider } from "@/lib/ai/config";
import { getBranding } from "@/lib/branding";
import { ldapEnabled } from "@/lib/ldap";

/**
 * Admin → System Status.
 *
 * Read-only "is everything configured?" dashboard for operators.
 * Mirrors `/api/system/features` but renders server-side so admins
 * don't have to open devtools to see which env vars are missing.
 *
 * Every feature row carries a one-line hint about which env var(s)
 * enable it, so a fresh deployment can be brought to green by setting
 * the listed keys.
 */

export const dynamic = "force-dynamic";

function ssoConfigured(): boolean {
  return !!(
    process.env.OIDC_ISSUER &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET
  );
}

export default async function SystemStatusPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const sso = ssoConfigured();
  const ldap = ldapEnabled();
  const ai = aiEnabled();
  const aiProvider = getActiveProvider();
  const webhookSigning = !!process.env.WEBHOOK_SIGNING_SECRET;
  const branding = await getBranding().catch(() => null);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System Status</h1>
        <p className="text-sm text-gray-600 mt-1">
          A live view of which optional features are wired up. Anything
          marked &ldquo;not configured&rdquo; falls back to safe behaviour
          in the UI (hidden / disabled) rather than throwing — but the
          feature won&apos;t be available to users until you set the
          listed environment variables and restart.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard
          title="Single Sign-On (OIDC)"
          enabled={sso}
          detail={sso ? "Provider configured" : "Disabled"}
          hint="Set OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET to enable."
        />

        <StatusCard
          title="LDAP / Active Directory"
          enabled={ldap}
          detail={ldap ? "Directory bind configured" : "Disabled"}
          hint="Set LDAP_URL, LDAP_BIND_DN, and LDAP_BIND_PASSWORD to enable. Manage group→role mappings under Admin → LDAP."
        />

        <StatusCard
          title="AI Features"
          enabled={ai}
          detail={
            ai
              ? `Active provider: ${aiProvider ?? "unknown"}`
              : "No provider configured"
          }
          hint="Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY (optionally pin with AI_PROVIDER)."
        />

        <StatusCard
          title="Webhook Signing"
          enabled={webhookSigning}
          detail={
            webhookSigning
              ? "Outgoing webhooks are HMAC-signed"
              : "Webhooks delivered unsigned"
          }
          hint="Set WEBHOOK_SIGNING_SECRET to enable HMAC signing."
        />

        <StatusCard
          title="Branding"
          enabled={!!branding?.orgName}
          detail={
            branding?.orgName
              ? `Organisation: ${branding.orgName}`
              : "Default branding"
          }
          hint="Configure via Admin → Branding. Stored in AppSetting, not env."
        />
      </div>
    </div>
  );
}

function StatusCard({
  title,
  enabled,
  detail,
  hint,
}: {
  title: string;
  enabled: boolean;
  detail: string;
  hint: string;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      <header className="flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            enabled
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800"
          }`}
          aria-label={enabled ? "Enabled" : "Disabled"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              enabled ? "bg-green-600" : "bg-amber-600"
            }`}
          />
          {enabled ? "✓ Enabled" : "✗ Disabled"}
        </span>
      </header>
      <p className="text-sm text-gray-700">{detail}</p>
      {!enabled && (
        <p className="text-xs text-gray-500 border-t border-gray-100 pt-2">
          {hint}
        </p>
      )}
    </section>
  );
}
