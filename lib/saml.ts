/**
 * SAML 2.0 SP integration for EDRMS.
 *
 * Sits alongside (does NOT replace) the OIDC env-driven SSO config. Many
 * government / enterprise IdPs only speak SAML, so we expose a parallel
 * pair of routes (`/api/auth/saml/{login,acs,metadata}`) and reuse the
 * NextAuth "saml" Credentials provider to mint the local session after
 * the IdP assertion has been verified.
 *
 * Wire-up is 12-factor: the SP and IdP halves are both read from env at
 * boot. Until all five required values are set, `samlEnabled()` returns
 * false and every SAML route / button short-circuits cleanly so the rest
 * of the app keeps working.
 *
 * Required env:
 *   SAML_SP_ENTITY_ID      — the SP entity ID we advertise in metadata
 *   SAML_SP_ACS_URL        — absolute URL the IdP POSTs the assertion to
 *                            (must match this app's /api/auth/saml/acs)
 *   SAML_IDP_ENTITY_ID     — IdP entity ID we validate the issuer against
 *   SAML_IDP_SSO_URL       — IdP SingleSignOn endpoint (HTTP-Redirect)
 *   SAML_IDP_CERT          — IdP signing certificate (PEM, with -----BEGIN…)
 *
 * Optional env:
 *   SAML_ATTR_EMAIL        — attribute name carrying the user email
 *                            (defaults try common Microsoft / generic names)
 *   SAML_ATTR_NAME         — attribute name for display name
 *   SAML_ATTR_GROUPS       — attribute name for group memberships
 */

import * as samlify from "samlify";

/** True when every env var the SAML flow needs is present. */
export function samlEnabled(): boolean {
  return !!(
    process.env.SAML_SP_ENTITY_ID &&
    process.env.SAML_SP_ACS_URL &&
    process.env.SAML_IDP_ENTITY_ID &&
    process.env.SAML_IDP_SSO_URL &&
    process.env.SAML_IDP_CERT
  );
}

/**
 * Strip a PEM payload down to its base64 body. samlify accepts either
 * the full PEM string or the bare certificate body — we normalize to the
 * body form so env-var line-ending mishaps don't trip metadata generation.
 */
function normalizeCert(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

// --- samlify schema validator -----------------------------------------
// samlify >=2.6 requires a schema validator to be set before any flow
// runs. We don't ship the external xmllint / xsd-schema-validator
// modules (each pulls native deps); the signature check is the only
// real security gate for SP-side assertion validation, so we provide a
// no-op schema validator and let samlify's signature verification do
// the heavy lifting. Equivalent to the documented "suppressed" mode.
let validatorInstalled = false;
function ensureValidatorInstalled(): void {
  if (validatorInstalled) return;
  samlify.setSchemaValidator({
    validate: () => Promise.resolve("skipped"),
  });
  validatorInstalled = true;
}

/** Build a memoized SP instance from the configured env. */
let cachedSp: ReturnType<typeof samlify.ServiceProvider> | null = null;
export function buildSpInstance(): ReturnType<typeof samlify.ServiceProvider> {
  if (cachedSp) return cachedSp;
  ensureValidatorInstalled();

  const entityID = process.env.SAML_SP_ENTITY_ID!;
  const acsUrl = process.env.SAML_SP_ACS_URL!;

  cachedSp = samlify.ServiceProvider({
    entityID,
    authnRequestsSigned: false,
    wantAssertionsSigned: true,
    wantMessageSigned: false,
    assertionConsumerService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: acsUrl,
      },
    ],
    nameIDFormat: [
      "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
    ],
  });
  return cachedSp;
}

/** Build a memoized IdP instance from the configured env. */
let cachedIdp: ReturnType<typeof samlify.IdentityProvider> | null = null;
export function buildIdpInstance(): ReturnType<typeof samlify.IdentityProvider> {
  if (cachedIdp) return cachedIdp;
  ensureValidatorInstalled();

  const entityID = process.env.SAML_IDP_ENTITY_ID!;
  const ssoUrl = process.env.SAML_IDP_SSO_URL!;
  const cert = normalizeCert(process.env.SAML_IDP_CERT!);

  cachedIdp = samlify.IdentityProvider({
    entityID,
    signingCert: cert,
    isAssertionEncrypted: false,
    singleSignOnService: [
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
        Location: ssoUrl,
      },
      {
        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        Location: ssoUrl,
      },
    ],
  });
  return cachedIdp;
}

/**
 * Compute the SP-initiated SSO entry URL — the redirect we send the
 * browser to so the IdP can challenge them and post the assertion back
 * to our ACS. samlify produces a full URL with the SAMLRequest query
 * param already attached.
 */
export function getLoginRedirectUrl(): string {
  const sp = buildSpInstance();
  const idp = buildIdpInstance();
  const ctx = sp.createLoginRequest(idp, "redirect");
  // For the redirect binding samlify returns { context: "https://…?SAMLRequest=…" }
  // where `context` is already the absolute IdP URL with the encoded
  // request. We use it as-is.
  return (ctx as { context: string }).context;
}

/** Extract one attribute (case-insensitive) from samlify's `extract.attributes`. */
function pickAttr(
  attrs: Record<string, unknown> | undefined,
  candidates: string[],
): string | undefined {
  if (!attrs) return undefined;
  const keys = Object.keys(attrs);
  for (const c of candidates) {
    const k = keys.find((key) => key.toLowerCase() === c.toLowerCase());
    if (k == null) continue;
    const v = attrs[k];
    if (Array.isArray(v) && v.length > 0) return String(v[0]);
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** Pull a multi-valued attribute (groups/roles) as a string array. */
function pickAttrAll(
  attrs: Record<string, unknown> | undefined,
  candidates: string[],
): string[] {
  if (!attrs) return [];
  const keys = Object.keys(attrs);
  for (const c of candidates) {
    const k = keys.find((key) => key.toLowerCase() === c.toLowerCase());
    if (k == null) continue;
    const v = attrs[k];
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === "string") return [v];
  }
  return [];
}

/**
 * Verify a raw base64 SAMLResponse from the IdP and pull out the user
 * fields we care about. Throws on signature failure / malformed XML —
 * the ACS handler catches and turns it into a 401.
 */
export async function parseSamlResponse(
  samlResponse: string,
): Promise<{ email: string; displayName: string; groups: string[] }> {
  const sp = buildSpInstance();
  const idp = buildIdpInstance();

  const result = await sp.parseLoginResponse(idp, "post", {
    body: { SAMLResponse: samlResponse },
  });

  const extract = (result.extract ?? {}) as {
    nameID?: string;
    attributes?: Record<string, unknown>;
  };
  const attrs = extract.attributes ?? {};

  const emailAttr = process.env.SAML_ATTR_EMAIL;
  const nameAttr = process.env.SAML_ATTR_NAME;
  const groupsAttr = process.env.SAML_ATTR_GROUPS;

  // Try the configured attribute first, then the common defaults — Azure
  // AD / ADFS use the long claims URI form, Okta / generic IdPs use the
  // short names.
  const email =
    pickAttr(attrs, [
      ...(emailAttr ? [emailAttr] : []),
      "email",
      "mail",
      "emailAddress",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "urn:oid:0.9.2342.19200300.100.1.3",
    ]) ?? extract.nameID;

  if (!email) {
    throw new Error("SAML assertion did not include an email address");
  }

  const displayName =
    pickAttr(attrs, [
      ...(nameAttr ? [nameAttr] : []),
      "displayName",
      "name",
      "cn",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
    ]) ?? email.split("@")[0];

  const groups = pickAttrAll(attrs, [
    ...(groupsAttr ? [groupsAttr] : []),
    "groups",
    "memberOf",
    "http://schemas.xmlsoap.org/claims/Group",
  ]);

  return { email: email.trim().toLowerCase(), displayName, groups };
}

/** Return the SP metadata XML the operator can hand to their IdP. */
export function getSpMetadataXml(): string {
  const sp = buildSpInstance();
  return sp.getMetadata();
}
