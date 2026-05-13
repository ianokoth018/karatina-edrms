import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";

/**
 * Runtime-configurable system settings, persisted in the AppSetting table.
 *
 * Secrets (e.g. SMTP password) are AES-256-GCM encrypted using
 * ENCRYPTION_KEY before being written to the database. Reads decrypt
 * transparently. Writes through the admin UI; reads from anywhere that
 * needs them (mailer, etc.).
 */

const SMTP_KEY = "smtp";
const DOCUSIGN_KEY = "docusign";
const NITRO_KEY = "nitro";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Plain-text password — decrypted at read time. */
  password: string;
  /** From-header (e.g. `"Karatina University EDRMS" <noreply@karu.ac.ke>`) */
  fromAddress: string;
}

interface StoredSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromAddress: string;
  /** Encrypted password fields, all base64. */
  passwordCipher?: { encrypted: string; iv: string; tag: string } | null;
}

function maskPassword(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 4) return "•".repeat(plain.length);
  return `${"•".repeat(Math.max(8, plain.length - 4))}${plain.slice(-4)}`;
}

/**
 * Load the SMTP config — falls back to environment variables when no row
 * exists yet (so existing deployments keep working before the admin saves
 * settings the first time).
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await db.appSetting.findUnique({ where: { key: SMTP_KEY } });

  if (row) {
    const stored = row.value as unknown as StoredSmtp;
    let password = "";
    if (stored.passwordCipher?.encrypted) {
      try {
        const buf = decrypt(
          Buffer.from(stored.passwordCipher.encrypted, "base64"),
          stored.passwordCipher.iv,
          stored.passwordCipher.tag,
        );
        password = buf.toString("utf8");
      } catch {
        password = "";
      }
    }
    return {
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      user: stored.user,
      password,
      fromAddress: stored.fromAddress,
    };
  }

  // Env-var fallback
  if (!process.env.SMTP_HOST) return null;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASS ?? "",
    fromAddress:
      process.env.SMTP_FROM ??
      `"Karatina University EDRMS" <noreply@${process.env.SMTP_HOST}>`,
  };
}

/**
 * Save SMTP config. Password is encrypted at rest. Pass an empty
 * `password` to leave the existing password untouched.
 */
export async function setSmtpConfig(
  cfg: Omit<SmtpConfig, "password"> & { password?: string },
  updatedById?: string,
): Promise<void> {
  let passwordCipher: StoredSmtp["passwordCipher"] | undefined;

  if (cfg.password && cfg.password.trim().length > 0) {
    const enc = encrypt(Buffer.from(cfg.password, "utf8"));
    passwordCipher = {
      encrypted: enc.encrypted.toString("base64"),
      iv: enc.iv,
      tag: enc.tag,
    };
  } else {
    // Preserve the existing password if the user didn't change it.
    const existing = await db.appSetting.findUnique({ where: { key: SMTP_KEY } });
    passwordCipher =
      (existing?.value as unknown as StoredSmtp | undefined)?.passwordCipher ??
      null;
  }

  const stored: StoredSmtp = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    fromAddress: cfg.fromAddress,
    passwordCipher,
  };

  await db.appSetting.upsert({
    where: { key: SMTP_KEY },
    create: {
      key: SMTP_KEY,
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
    update: {
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
  });
}

/**
 * Read-safe shape for sending to the admin UI — never includes the raw
 * password, only a masked indicator that one is set.
 */
export interface SmtpConfigSafe {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordMask: string;
  hasPassword: boolean;
  fromAddress: string;
  source: "database" | "env" | "none";
}

// ===========================================================================
// DocuSign
// ===========================================================================

export interface DocusignConfig {
  /** Integration key (Client ID) from DocuSign Apps & Keys. */
  integrationKey: string;
  /** API account ID (GUID) — found at Settings → Apps and Keys → User ID. */
  accountId: string;
  /** Base URL: account-d.docusign.com (demo) or account.docusign.com (prod). */
  oauthBasePath: "account-d.docusign.com" | "account.docusign.com";
  /** REST base path: demo.docusign.net/restapi or www.docusign.net/restapi. */
  restBasePath: string;
  /** GUID of the DocuSign user the JWT is impersonating (the system "memo signer"). */
  impersonationUserId: string;
  /** PEM-encoded RSA private key bound to the integration key. */
  privateKey: string;
  /** Whether DocuSign signing is on. */
  enabled: boolean;
}

interface StoredDocusign {
  integrationKey: string;
  accountId: string;
  oauthBasePath: "account-d.docusign.com" | "account.docusign.com";
  restBasePath: string;
  impersonationUserId: string;
  enabled: boolean;
  privateKeyCipher?: { encrypted: string; iv: string; tag: string } | null;
}

export interface DocusignConfigSafe {
  integrationKey: string;
  accountId: string;
  oauthBasePath: string;
  restBasePath: string;
  impersonationUserId: string;
  enabled: boolean;
  hasPrivateKey: boolean;
  source: "database" | "none";
}

export async function getDocusignConfig(): Promise<DocusignConfig | null> {
  const row = await db.appSetting.findUnique({ where: { key: DOCUSIGN_KEY } });
  if (!row) return null;
  const stored = row.value as unknown as StoredDocusign;
  let privateKey = "";
  if (stored.privateKeyCipher?.encrypted) {
    try {
      privateKey = decrypt(
        Buffer.from(stored.privateKeyCipher.encrypted, "base64"),
        stored.privateKeyCipher.iv,
        stored.privateKeyCipher.tag,
      ).toString("utf8");
    } catch {
      privateKey = "";
    }
  }
  if (!privateKey) return null;
  return {
    integrationKey: stored.integrationKey,
    accountId: stored.accountId,
    oauthBasePath: stored.oauthBasePath,
    restBasePath: stored.restBasePath,
    impersonationUserId: stored.impersonationUserId,
    privateKey,
    enabled: stored.enabled,
  };
}

export async function setDocusignConfig(
  cfg: Omit<DocusignConfig, "privateKey"> & { privateKey?: string },
  updatedById?: string,
): Promise<void> {
  let privateKeyCipher: StoredDocusign["privateKeyCipher"] | undefined;
  if (cfg.privateKey && cfg.privateKey.trim().length > 0) {
    const enc = encrypt(Buffer.from(cfg.privateKey, "utf8"));
    privateKeyCipher = {
      encrypted: enc.encrypted.toString("base64"),
      iv: enc.iv,
      tag: enc.tag,
    };
  } else {
    const existing = await db.appSetting.findUnique({
      where: { key: DOCUSIGN_KEY },
    });
    privateKeyCipher =
      (existing?.value as unknown as StoredDocusign | undefined)
        ?.privateKeyCipher ?? null;
  }

  const stored: StoredDocusign = {
    integrationKey: cfg.integrationKey,
    accountId: cfg.accountId,
    oauthBasePath: cfg.oauthBasePath,
    restBasePath: cfg.restBasePath,
    impersonationUserId: cfg.impersonationUserId,
    enabled: cfg.enabled,
    privateKeyCipher,
  };

  await db.appSetting.upsert({
    where: { key: DOCUSIGN_KEY },
    create: {
      key: DOCUSIGN_KEY,
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
    update: {
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
  });
}

export async function getDocusignConfigSafe(): Promise<DocusignConfigSafe> {
  const row = await db.appSetting.findUnique({ where: { key: DOCUSIGN_KEY } });
  if (!row) {
    return {
      integrationKey: "",
      accountId: "",
      oauthBasePath: "account-d.docusign.com",
      restBasePath: "https://demo.docusign.net/restapi",
      impersonationUserId: "",
      enabled: false,
      hasPrivateKey: false,
      source: "none",
    };
  }
  const stored = row.value as unknown as StoredDocusign;
  return {
    integrationKey: stored.integrationKey,
    accountId: stored.accountId,
    oauthBasePath: stored.oauthBasePath,
    restBasePath: stored.restBasePath,
    impersonationUserId: stored.impersonationUserId,
    enabled: stored.enabled,
    hasPrivateKey: !!stored.privateKeyCipher,
    source: "database",
  };
}

// ===========================================================================
// Nitro Sign
// ===========================================================================
//
// Nitro Sign is Nitro's cloud e-signature service. Auth is OAuth2
// client-credentials — far simpler than DocuSign JWT (no RSA keypair, no
// one-time impersonation consent). Admin pastes a client id + secret from
// the Nitro Sign developer portal; we exchange those for a bearer token
// at the OAuth endpoint and call the Sign REST API.

export interface NitroConfig {
  /** Client ID from the Nitro Sign developer portal. */
  clientId: string;
  /** Plain client secret (decrypted at read time). */
  clientSecret: string;
  /** "sandbox" or "production" — controls default base URLs. */
  environment: "sandbox" | "production";
  /** OAuth token endpoint (e.g. https://api.gonitro.com/oauth/token). */
  oauthTokenUrl: string;
  /** Sign API base (e.g. https://api.gonitro.com/sign/v2). */
  apiBaseUrl: string;
  /** Optional webhook HMAC signing secret — used to verify callbacks. */
  webhookSecret: string;
  /** Whether Nitro Sign signing is on. */
  enabled: boolean;
}

interface StoredNitro {
  clientId: string;
  environment: "sandbox" | "production";
  oauthTokenUrl: string;
  apiBaseUrl: string;
  enabled: boolean;
  clientSecretCipher?: { encrypted: string; iv: string; tag: string } | null;
  webhookSecretCipher?: { encrypted: string; iv: string; tag: string } | null;
}

export interface NitroConfigSafe {
  clientId: string;
  environment: "sandbox" | "production";
  oauthTokenUrl: string;
  apiBaseUrl: string;
  enabled: boolean;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  source: "database" | "none";
}

function decryptCipher(
  cipher: { encrypted: string; iv: string; tag: string } | null | undefined,
): string {
  if (!cipher?.encrypted) return "";
  try {
    return decrypt(
      Buffer.from(cipher.encrypted, "base64"),
      cipher.iv,
      cipher.tag,
    ).toString("utf8");
  } catch {
    return "";
  }
}

function encryptCipher(plain: string): StoredNitro["clientSecretCipher"] {
  const enc = encrypt(Buffer.from(plain, "utf8"));
  return {
    encrypted: enc.encrypted.toString("base64"),
    iv: enc.iv,
    tag: enc.tag,
  };
}

export async function getNitroConfig(): Promise<NitroConfig | null> {
  const row = await db.appSetting.findUnique({ where: { key: NITRO_KEY } });
  if (!row) return null;
  const stored = row.value as unknown as StoredNitro;
  const clientSecret = decryptCipher(stored.clientSecretCipher);
  if (!clientSecret) return null;
  return {
    clientId: stored.clientId,
    clientSecret,
    environment: stored.environment,
    oauthTokenUrl: stored.oauthTokenUrl,
    apiBaseUrl: stored.apiBaseUrl,
    webhookSecret: decryptCipher(stored.webhookSecretCipher),
    enabled: stored.enabled,
  };
}

export async function setNitroConfig(
  cfg: Omit<NitroConfig, "clientSecret" | "webhookSecret"> & {
    clientSecret?: string;
    webhookSecret?: string;
  },
  updatedById?: string,
): Promise<void> {
  const existing = await db.appSetting.findUnique({
    where: { key: NITRO_KEY },
  });
  const prev = existing?.value as unknown as StoredNitro | undefined;

  const clientSecretCipher = cfg.clientSecret?.trim()
    ? encryptCipher(cfg.clientSecret)
    : (prev?.clientSecretCipher ?? null);

  const webhookSecretCipher = cfg.webhookSecret?.trim()
    ? encryptCipher(cfg.webhookSecret)
    : (prev?.webhookSecretCipher ?? null);

  const stored: StoredNitro = {
    clientId: cfg.clientId,
    environment: cfg.environment,
    oauthTokenUrl: cfg.oauthTokenUrl,
    apiBaseUrl: cfg.apiBaseUrl,
    enabled: cfg.enabled,
    clientSecretCipher,
    webhookSecretCipher,
  };

  await db.appSetting.upsert({
    where: { key: NITRO_KEY },
    create: {
      key: NITRO_KEY,
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
    update: {
      value: stored as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
  });
}

export async function getNitroConfigSafe(): Promise<NitroConfigSafe> {
  const row = await db.appSetting.findUnique({ where: { key: NITRO_KEY } });
  if (!row) {
    return {
      clientId: "",
      environment: "sandbox",
      oauthTokenUrl: "https://api.sandbox.gonitro.com/oauth/token",
      apiBaseUrl: "https://api.sandbox.gonitro.com/sign/v2",
      enabled: false,
      hasClientSecret: false,
      hasWebhookSecret: false,
      source: "none",
    };
  }
  const stored = row.value as unknown as StoredNitro;
  return {
    clientId: stored.clientId,
    environment: stored.environment,
    oauthTokenUrl: stored.oauthTokenUrl,
    apiBaseUrl: stored.apiBaseUrl,
    enabled: stored.enabled,
    hasClientSecret: !!stored.clientSecretCipher,
    hasWebhookSecret: !!stored.webhookSecretCipher,
    source: "database",
  };
}

export async function getSmtpConfigSafe(): Promise<SmtpConfigSafe> {
  const row = await db.appSetting.findUnique({ where: { key: SMTP_KEY } });
  if (row) {
    const stored = row.value as unknown as StoredSmtp;
    return {
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      user: stored.user,
      passwordMask: stored.passwordCipher ? "•••••••••••" : "",
      hasPassword: !!stored.passwordCipher,
      fromAddress: stored.fromAddress,
      source: "database",
    };
  }
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER ?? "",
      passwordMask: maskPassword(process.env.SMTP_PASS ?? ""),
      hasPassword: !!process.env.SMTP_PASS,
      fromAddress:
        process.env.SMTP_FROM ??
        `"Karatina University EDRMS" <noreply@${process.env.SMTP_HOST}>`,
      source: "env",
    };
  }
  return {
    host: "",
    port: 587,
    secure: false,
    user: "",
    passwordMask: "",
    hasPassword: false,
    fromAddress: "",
    source: "none",
  };
}

const WATERMARK_KEY = "watermark";

export interface WatermarkConfig {
  enabled: boolean;
  minClassification:
    | "OPEN"
    | "CONFIDENTIAL"
    | "RESTRICTED"
    | "SECRET"
    | "TOP_SECRET";
  text: string;
}

const WATERMARK_DEFAULTS: WatermarkConfig = {
  enabled: false,
  minClassification: "CONFIDENTIAL",
  text: "",
};

export async function getWatermarkConfig(): Promise<WatermarkConfig> {
  const row = await db.appSetting.findUnique({ where: { key: WATERMARK_KEY } });
  const raw = (row?.value as Partial<WatermarkConfig> | null) ?? null;
  if (!raw) return WATERMARK_DEFAULTS;
  return {
    enabled: raw.enabled ?? WATERMARK_DEFAULTS.enabled,
    minClassification: raw.minClassification ?? WATERMARK_DEFAULTS.minClassification,
    text: raw.text ?? WATERMARK_DEFAULTS.text,
  };
}

export async function setWatermarkConfig(
  input: WatermarkConfig,
  updatedById: string | null
): Promise<WatermarkConfig> {
  await db.appSetting.upsert({
    where: { key: WATERMARK_KEY },
    create: {
      key: WATERMARK_KEY,
      value: input as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? undefined,
    },
    update: {
      value: input as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? undefined,
    },
  });
  return input;
}
