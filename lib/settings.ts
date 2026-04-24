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
