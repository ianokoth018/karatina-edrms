import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Runtime brand/theme configuration, persisted in the AppSetting table under
 * the `branding` key. Read at request time by the root layout (so changes
 * apply on next page load) and by the admin settings UI.
 *
 * The shape is intentionally small and additive: it overlays existing
 * `karu-green` / `karu-gold` Tailwind tokens via CSS variables rather than
 * replacing them, so legacy class usage continues to work.
 */

const BRANDING_KEY = "branding";

export interface Branding {
  orgName: string;
  /** ≤ 16 chars — used in the sidebar/header where space is tight. */
  orgShortName: string;
  /** Hex, e.g. "#02773b". */
  primaryColor: string;
  /** Hex, e.g. "#dd9f42". */
  accentColor: string;
  logoUrl?: string;
  faviconUrl?: string;
  footerText?: string;
}

export const DEFAULT_BRANDING: Branding = {
  orgName: "Karatina University",
  orgShortName: "Karatina",
  primaryColor: "#02773b",
  accentColor: "#dd9f42",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function normalize(value: Partial<Branding> | null | undefined): Branding {
  const v = value ?? {};
  return {
    orgName:
      typeof v.orgName === "string" && v.orgName.trim().length > 0
        ? v.orgName.trim()
        : DEFAULT_BRANDING.orgName,
    orgShortName:
      typeof v.orgShortName === "string" && v.orgShortName.trim().length > 0
        ? v.orgShortName.trim().slice(0, 16)
        : DEFAULT_BRANDING.orgShortName,
    primaryColor: isHexColor(v.primaryColor)
      ? v.primaryColor
      : DEFAULT_BRANDING.primaryColor,
    accentColor: isHexColor(v.accentColor)
      ? v.accentColor
      : DEFAULT_BRANDING.accentColor,
    logoUrl:
      typeof v.logoUrl === "string" && v.logoUrl.trim().length > 0
        ? v.logoUrl.trim()
        : undefined,
    faviconUrl:
      typeof v.faviconUrl === "string" && v.faviconUrl.trim().length > 0
        ? v.faviconUrl.trim()
        : undefined,
    footerText:
      typeof v.footerText === "string" && v.footerText.trim().length > 0
        ? v.footerText.trim()
        : undefined,
  };
}

/** Read the branding row; returns defaults when none exists or DB is unreachable. */
export async function getBranding(): Promise<Branding> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: BRANDING_KEY } });
    if (!row) return { ...DEFAULT_BRANDING };
    return normalize(row.value as unknown as Partial<Branding> | null);
  } catch {
    // Never let branding-fetch errors break page rendering.
    return { ...DEFAULT_BRANDING };
  }
}

/**
 * Upsert branding. Only the fields supplied are changed — others are
 * carried forward from the existing row (or filled from defaults).
 */
export async function setBranding(
  input: Partial<Branding>,
  updatedById?: string,
): Promise<Branding> {
  const current = await getBranding();
  const merged: Branding = normalize({ ...current, ...input });

  await db.appSetting.upsert({
    where: { key: BRANDING_KEY },
    create: {
      key: BRANDING_KEY,
      value: merged as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
    update: {
      value: merged as unknown as Prisma.InputJsonValue,
      updatedById: updatedById ?? null,
    },
  });

  return merged;
}
