import crypto from "crypto";
import { getNitroConfig } from "@/lib/settings";

/**
 * Direct REST client for Nitro Sign — no SDK dependency.
 *
 * Auth: OAuth2 client-credentials. The admin pastes a Client ID + Client
 * Secret from the Nitro Sign developer portal; we POST those to
 * `<oauthTokenUrl>` to get a bearer token, then call the Sign REST API
 * at `<apiBaseUrl>`.
 *
 * Why this shape mirrors lib/docusign.ts:
 *   - Same operations: createTransaction (≈ createEnvelope),
 *     getTransactionStatus (≈ getEnvelopeStatus),
 *     downloadSignedPdf, verifyWebhookSignature.
 *   - Same caching model: token cached in module-level memory until
 *     ~60s before expiry.
 *   - Endpoint paths are kept as plain strings so they're trivial to
 *     adjust if Nitro renames a route — no SDK to upgrade.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Reset the in-memory token cache. Useful after rotating credentials. */
export function resetTokenCache(): void {
  cachedToken = null;
}

export async function getAccessToken(): Promise<{
  token: string;
  apiBaseUrl: string;
}> {
  const cfg = await getNitroConfig();
  if (!cfg) throw new Error("Nitro Sign is not configured.");
  if (!cfg.enabled) throw new Error("Nitro Sign integration is disabled.");

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.token, apiBaseUrl: cfg.apiBaseUrl };
  }

  const res = await fetch(cfg.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "sign",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Nitro Sign token exchange failed (${res.status}): ${body || res.statusText}`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return { token: data.access_token, apiBaseUrl: cfg.apiBaseUrl };
}

export interface CreateTransactionParams {
  pdfBytes: Uint8Array;
  pdfName: string;
  signerEmail: string;
  signerName: string;
  emailSubject: string;
  embedded: boolean;
  /** Anchor string in the PDF for the signature placement. */
  signHereAnchor?: string;
  returnUrl?: string;
  /** Stable per-user id so we can request an embedded signing URL. */
  clientUserId?: string;
}

/**
 * Create a Nitro Sign transaction with one signer + one document.
 *
 * Returns `{ transactionId, signingUrl? }`. When `embedded` + `clientUserId`
 * + `returnUrl` are all provided, a same-window signing URL is requested
 * so the user signs inside the EDRMS modal instead of jumping to Nitro.
 */
export async function createTransaction(
  params: CreateTransactionParams,
): Promise<{ transactionId: string; signingUrl?: string }> {
  const { token, apiBaseUrl } = await getAccessToken();

  const body = {
    name: params.emailSubject,
    emailSubject: params.emailSubject,
    documents: [
      {
        name: params.pdfName,
        fileName: params.pdfName,
        contentBase64: Buffer.from(params.pdfBytes).toString("base64"),
      },
    ],
    signers: [
      {
        recipientId: "1",
        email: params.signerEmail,
        name: params.signerName,
        order: 1,
        ...(params.embedded && params.clientUserId
          ? { clientUserId: params.clientUserId, embedded: true }
          : {}),
        fields: [
          {
            type: "signature",
            anchor: {
              text: params.signHereAnchor ?? "/sn1/",
              yOffset: 10,
              xOffset: 20,
              units: "pixels",
            },
          },
        ],
      },
    ],
    status: "sent",
  };

  const createRes = await fetch(`${apiBaseUrl}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(
      `Nitro Sign transaction create failed: ${text || createRes.statusText}`,
    );
  }
  const created = (await createRes.json()) as {
    transactionId?: string;
    id?: string;
  };
  const transactionId = created.transactionId ?? created.id;
  if (!transactionId) {
    throw new Error(
      "Nitro Sign transaction create returned no transactionId.",
    );
  }

  let signingUrl: string | undefined;
  if (params.embedded && params.clientUserId && params.returnUrl) {
    const viewRes = await fetch(
      `${apiBaseUrl}/transactions/${transactionId}/signing-url`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientId: "1",
          clientUserId: params.clientUserId,
          returnUrl: params.returnUrl,
        }),
      },
    );
    if (!viewRes.ok) {
      const text = await viewRes.text().catch(() => "");
      throw new Error(
        `Nitro Sign signing-url request failed: ${text || viewRes.statusText}`,
      );
    }
    const view = (await viewRes.json()) as { url?: string; signingUrl?: string };
    signingUrl = view.url ?? view.signingUrl;
  }

  return { transactionId, signingUrl };
}

export async function getTransactionStatus(
  transactionId: string,
): Promise<string> {
  const { token, apiBaseUrl } = await getAccessToken();
  const res = await fetch(`${apiBaseUrl}/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Nitro Sign status lookup failed: ${text || res.statusText}`,
    );
  }
  const data = (await res.json()) as { status?: string };
  return data.status ?? "unknown";
}

/**
 * Download the completed transaction's signed PDF + audit trail merged
 * into one file. Nitro names this "combined" / "with-audit"; we keep both
 * candidates and fall through if one isn't available.
 */
export async function downloadSignedPdf(
  transactionId: string,
): Promise<Buffer> {
  const { token, apiBaseUrl } = await getAccessToken();
  const candidates = [
    `${apiBaseUrl}/transactions/${transactionId}/documents/combined`,
    `${apiBaseUrl}/transactions/${transactionId}/documents/signed`,
  ];
  let lastError = "Nitro Sign download failed";
  for (const url of candidates) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
    lastError = `${res.status} ${res.statusText}`;
  }
  throw new Error(`Nitro Sign signed-PDF download failed: ${lastError}`);
}

/**
 * Verify a Nitro Sign Connect webhook by HMAC-SHA256 of the raw body
 * against the shared webhook secret. Returns true when the secret isn't
 * configured (so unsigned callbacks during local dev don't 401), but in
 * production the admin should always set a secret.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  // signatureHeader may be hex or "sha256=hex"; accept both.
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  if (provided.length !== computed.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(computed, "hex"),
  );
}
