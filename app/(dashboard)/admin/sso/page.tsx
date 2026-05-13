import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SsoProbeButton } from "./probe-button";

/**
 * Admin → SSO settings.
 *
 * This page is intentionally read-only: OIDC config is sourced from env
 * vars (12-factor / deployment-controlled), not from the database. The
 * page tells the operator what is currently wired up and exposes a
 * one-click discovery probe to confirm the IdP is reachable.
 */
export default async function SsoSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const issuer = process.env.OIDC_ISSUER ?? "";
  const clientId = process.env.OIDC_CLIENT_ID ?? "";
  const clientSecretSet = !!process.env.OIDC_CLIENT_SECRET;
  const displayName = process.env.OIDC_NAME || "Single Sign-On";
  const configured = !!(issuer && clientId && clientSecretSet);

  const callbackUrl = (() => {
    // Best-effort guess; operators copy this into the IdP's allowed
    // redirect URI list. We don't know the public origin at build time,
    // so show the path and let the operator prefix their domain.
    return "/api/auth/callback/oidc";
  })();

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Single Sign-On (OIDC)</h1>
        <p className="text-sm text-gray-600 mt-1">
          Connect EDRMS to your organisation&apos;s identity provider via
          OpenID Connect. Configuration is supplied through environment
          variables and read at startup.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-medium">Current configuration</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              configured
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                configured ? "bg-green-600" : "bg-amber-600"
              }`}
            />
            {configured ? "Configured" : "Not configured"}
          </span>
        </header>
        <dl className="divide-y divide-gray-100 text-sm">
          <Row label="Display name" value={displayName} />
          <Row
            label="Issuer URL"
            value={issuer || <span className="text-gray-400 italic">(unset)</span>}
            mono
          />
          <Row
            label="Client ID"
            value={clientId || <span className="text-gray-400 italic">(unset)</span>}
            mono
          />
          <Row
            label="Client secret"
            value={
              clientSecretSet ? (
                <span className="text-gray-600">●●●●●●●● (set)</span>
              ) : (
                <span className="text-gray-400 italic">(unset)</span>
              )
            }
          />
          <Row label="Redirect URI" value={callbackUrl} mono />
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="font-medium">Test discovery</h2>
        <p className="text-sm text-gray-600">
          Fetches{" "}
          <code className="rounded bg-gray-100 px-1">
            {issuer ? `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration` : "<issuer>/.well-known/openid-configuration"}
          </code>{" "}
          and shows whether the IdP is reachable and well-formed.
        </p>
        <SsoProbeButton disabled={!issuer} />
      </section>

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="font-medium mb-2">Environment variables</h2>
        <p className="text-sm text-gray-600 mb-3">
          Set these in your <code className="bg-white px-1 rounded border">.env</code>{" "}
          (or deployment platform&apos;s secret store) and restart the app.
          All three core variables must be present to enable the OIDC
          provider; the display name is optional.
        </p>
        <pre className="bg-white border border-gray-200 rounded p-3 text-xs overflow-x-auto">
{`OIDC_ISSUER="https://idp.example.org/realms/karu"
OIDC_CLIENT_ID="edrms"
OIDC_CLIENT_SECRET="..."
OIDC_NAME="Karatina SSO"   # optional, shown on the sign-in button`}
        </pre>
        <ul className="mt-3 text-xs text-gray-600 space-y-1 list-disc list-inside">
          <li>
            <strong>OIDC_ISSUER</strong> — the IdP&apos;s issuer URL; NextAuth
            auto-discovers endpoints from{" "}
            <code>{`<issuer>/.well-known/openid-configuration`}</code>.
          </li>
          <li>
            <strong>OIDC_CLIENT_ID / OIDC_CLIENT_SECRET</strong> — credentials
            of the application registered with the IdP.
          </li>
          <li>
            Register the redirect URI{" "}
            <code>{`<your-origin>${callbackUrl}`}</code> with the IdP.
          </li>
          <li>
            The IdP must release the <code>email</code> claim. First-time
            sign-ins create a local user automatically with no roles
            assigned — an admin grants permissions afterwards.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 px-4 py-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`col-span-2 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
