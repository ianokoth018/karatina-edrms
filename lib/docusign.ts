import crypto from "crypto";
import { getDocusignConfig } from "@/lib/settings";

/**
 * Direct REST client for DocuSign — no SDK dependency.
 *
 * Auth: JWT Grant (server-to-server impersonation). The system signs a
 * JWT with the integration's private key, exchanges it for an access
 * token at `<oauthBasePath>/oauth/token`, then calls the REST API at
 * `<restBasePath>/v2.1/accounts/<accountId>/...`.
 *
 * Prerequisites:
 *   1. A DocuSign account (developer or production).
 *   2. An integration key with JWT Grant + impersonation scope.
 *   3. RSA keypair on the integration; private key saved in AppSetting.
 *   4. One-time consent granted for the impersonation user.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwt(
  integrationKey: string,
  userId: string,
  oauthBasePath: string,
  privateKey: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: integrationKey,
      sub: userId,
      iat: now,
      exp: now + 3600,
      aud: oauthBasePath,
      scope: "signature impersonation",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(privateKey));
  return `${signingInput}.${signature}`;
}

export async function getAccessToken(): Promise<{
  token: string;
  accountId: string;
  basePath: string;
}> {
  const cfg = await getDocusignConfig();
  if (!cfg) throw new Error("DocuSign is not configured.");
  if (!cfg.enabled) throw new Error("DocuSign integration is disabled.");

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return {
      token: cachedToken.token,
      accountId: cfg.accountId,
      basePath: cfg.restBasePath,
    };
  }

  const jwt = buildJwt(
    cfg.integrationKey,
    cfg.impersonationUserId,
    cfg.oauthBasePath,
    cfg.privateKey,
  );

  const res = await fetch(`https://${cfg.oauthBasePath}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `DocuSign JWT exchange failed (${res.status}): ${body || res.statusText}. ` +
        `If this is a "consent_required" error, visit the consent URL once to grant impersonation.`,
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return {
    token: data.access_token,
    accountId: cfg.accountId,
    basePath: cfg.restBasePath,
  };
}

export interface CreateEnvelopeParams {
  pdfBytes: Uint8Array;
  pdfName: string;
  signerEmail: string;
  signerName: string;
  emailSubject: string;
  embedded: boolean;
  signHereAnchor?: string;
  returnUrl?: string;
  clientUserId?: string;
}

export async function createEnvelope(params: CreateEnvelopeParams): Promise<{
  envelopeId: string;
  signingUrl?: string;
}> {
  const { token, accountId, basePath } = await getAccessToken();

  const envelope = {
    emailSubject: params.emailSubject,
    // Disable the default top-left envelope-id stamp; we place it
    // ourselves via envelopeIdTabs anchored on "/envid/" below the
    // signature block so it doesn't clobber the memo letterhead.
    envelopeIdStamping: "false",
    documents: [
      {
        documentBase64: Buffer.from(params.pdfBytes).toString("base64"),
        name: params.pdfName,
        fileExtension: "pdf",
        documentId: "1",
      },
    ],
    recipients: {
      signers: [
        {
          email: params.signerEmail,
          name: params.signerName,
          recipientId: "1",
          routingOrder: "1",
          ...(params.embedded && params.clientUserId
            ? { clientUserId: params.clientUserId }
            : {}),
          tabs: {
            signHereTabs: [
              {
                anchorString: params.signHereAnchor ?? "/sn1/",
                anchorYOffset: "10",
                anchorUnits: "pixels",
                anchorXOffset: "20",
              },
            ],
            envelopeIdTabs: [
              {
                anchorString: "/envid/",
                anchorYOffset: "0",
                anchorUnits: "pixels",
                anchorXOffset: "0",
                font: "Helvetica",
                fontSize: "Size7",
              },
            ],
          },
        },
      ],
    },
    status: "sent",
  };

  const createRes = await fetch(
    `${basePath}/v2.1/accounts/${accountId}/envelopes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    },
  );
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`DocuSign envelope create failed: ${body || createRes.statusText}`);
  }
  const created = (await createRes.json()) as { envelopeId: string };
  const envelopeId = created.envelopeId;

  let signingUrl: string | undefined;
  if (params.embedded && params.clientUserId && params.returnUrl) {
    const viewRes = await fetch(
      `${basePath}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authenticationMethod: "none",
          clientUserId: params.clientUserId,
          recipientId: "1",
          returnUrl: params.returnUrl,
          userName: params.signerName,
          email: params.signerEmail,
        }),
      },
    );
    if (!viewRes.ok) {
      const body = await viewRes.text().catch(() => "");
      throw new Error(`DocuSign signing-view failed: ${body || viewRes.statusText}`);
    }
    const view = (await viewRes.json()) as { url?: string };
    signingUrl = view.url;
  }

  return { envelopeId, signingUrl };
}

export async function getEnvelopeStatus(envelopeId: string): Promise<string> {
  const { token, accountId, basePath } = await getAccessToken();
  const res = await fetch(
    `${basePath}/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DocuSign status lookup failed: ${body || res.statusText}`);
  }
  const data = (await res.json()) as { status?: string };
  return data.status ?? "unknown";
}

export async function downloadSignedPdf(envelopeId: string): Promise<Buffer> {
  const { token, accountId, basePath } = await getAccessToken();
  // documentId="combined" merges the signed PDF with the certificate of completion.
  const res = await fetch(
    `${basePath}/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DocuSign signed-PDF download failed: ${body || res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
