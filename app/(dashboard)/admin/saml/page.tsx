import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { samlEnabled } from "@/lib/saml";

/**
 * Admin → SAML SSO settings.
 *
 * Same posture as the OIDC admin page: env-driven config, read-only.
 * Tells the operator which env vars are wired up, shows the SP entity
 * ID + ACS URL their IdP needs, and exposes the metadata XML download
 * so they can hand it to the IdP admin in one click.
 */
export const dynamic = "force-dynamic";

export default async function SamlSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.permissions?.includes("admin:manage")) {
    return <div className="p-6 text-red-600">Forbidden</div>;
  }

  const spEntityId = process.env.SAML_SP_ENTITY_ID ?? "";
  const spAcsUrl = process.env.SAML_SP_ACS_URL ?? "";
  const idpEntityId = process.env.SAML_IDP_ENTITY_ID ?? "";
  const idpSsoUrl = process.env.SAML_IDP_SSO_URL ?? "";
  const idpCertSet = !!process.env.SAML_IDP_CERT;
  const configured = samlEnabled();

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Single Sign-On (SAML 2.0)</h1>
        <p className="text-sm text-gray-600 mt-1">
          Connect EDRMS to a SAML 2.0 identity provider (Okta, Azure AD /
          Entra ID, ADFS, Google Workspace, Shibboleth, etc.).
          Configuration is supplied through environment variables and read
          at startup, alongside any OIDC config.
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
          <Row
            label="SP entity ID"
            value={
              spEntityId || <span className="text-gray-400 italic">(unset)</span>
            }
            mono
          />
          <Row
            label="SP ACS URL"
            value={
              spAcsUrl || <span className="text-gray-400 italic">(unset)</span>
            }
            mono
          />
          <Row
            label="IdP entity ID"
            value={
              idpEntityId || (
                <span className="text-gray-400 italic">(unset)</span>
              )
            }
            mono
          />
          <Row
            label="IdP SSO URL"
            value={
              idpSsoUrl || (
                <span className="text-gray-400 italic">(unset)</span>
              )
            }
            mono
          />
          <Row
            label="IdP signing certificate"
            value={
              idpCertSet ? (
                <span className="text-gray-600">●●●●●●●● (set)</span>
              ) : (
                <span className="text-gray-400 italic">(unset)</span>
              )
            }
          />
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="font-medium">Service Provider metadata</h2>
        <p className="text-sm text-gray-600">
          Hand this XML to your IdP admin to register EDRMS as a trusted
          SP. The URL stays fresh — re-download whenever you change env.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded bg-gray-100 px-2 py-1 text-xs">
            /api/auth/saml/metadata
          </code>
          <a
            href="/api/auth/saml/metadata"
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              configured
                ? "bg-[#02773b] text-white hover:bg-[#014d28]"
                : "bg-gray-200 text-gray-500 cursor-not-allowed pointer-events-none"
            }`}
            aria-disabled={!configured}
          >
            Download SP metadata
          </a>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="font-medium">Login URLs</h2>
        <dl className="divide-y divide-gray-100 text-sm">
          <Row
            label="SP-initiated login"
            value={
              <a
                href="/api/auth/saml/login"
                className="text-[#02773b] hover:underline font-mono text-xs"
              >
                /api/auth/saml/login
              </a>
            }
          />
          <Row
            label="ACS (callback)"
            value={
              <span className="font-mono text-xs">
                {spAcsUrl || "/api/auth/saml/acs"}
              </span>
            }
          />
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="font-medium mb-2">Environment variables</h2>
        <p className="text-sm text-gray-600 mb-3">
          Set these in your <code className="bg-white px-1 rounded border">.env</code>{" "}
          (or deployment platform&apos;s secret store) and restart the app.
          All five required values must be present to enable the SAML
          provider; the attribute name overrides are optional.
        </p>
        <pre className="bg-white border border-gray-200 rounded p-3 text-xs overflow-x-auto">
{`# Required
SAML_SP_ENTITY_ID="https://edrms.example.org/saml"
SAML_SP_ACS_URL="https://edrms.example.org/api/auth/saml/acs"
SAML_IDP_ENTITY_ID="https://idp.example.org/saml/metadata"
SAML_IDP_SSO_URL="https://idp.example.org/saml/sso"
SAML_IDP_CERT="-----BEGIN CERTIFICATE-----\\nMIID...\\n-----END CERTIFICATE-----"

# Optional attribute overrides (defaults handle Okta / Azure AD / generic)
SAML_ATTR_EMAIL="email"
SAML_ATTR_NAME="displayName"
SAML_ATTR_GROUPS="groups"`}
        </pre>
        <ul className="mt-3 text-xs text-gray-600 space-y-1 list-disc list-inside">
          <li>
            Register the ACS URL above with your IdP and configure it to
            release the user&apos;s email and (optionally) display name and
            group memberships.
          </li>
          <li>
            First-time sign-ins create a local user automatically with no
            roles — an admin grants permissions afterwards.
          </li>
          <li>
            The IdP signing certificate is used to verify every incoming
            assertion. Rotate it by replacing the env var and restarting.
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
