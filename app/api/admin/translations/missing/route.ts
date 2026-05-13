import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import en from "@/lib/i18n/locales/en";
import sw from "@/lib/i18n/locales/sw";
import { flattenDictionary } from "@/lib/i18n/walk";
import { translationKey } from "@/lib/i18n/auto-translate";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/translations/missing?targetLocale=sw
 *
 * Diff between the EN source dictionary and (SW dictionary ∪ TranslationCache).
 * Returns a list of `{ key, sourceText }` entries that are neither in the SW
 * dictionary nor in the cache — i.e. the strings the admin should translate.
 */
const DICTIONARIES: Record<string, unknown> = { en, sw };

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const targetLocale = url.searchParams.get("targetLocale") ?? "sw";
    const sourceLocale = "en";

    const sourceFlat = flattenDictionary(DICTIONARIES[sourceLocale]);
    const targetFlat = flattenDictionary(DICTIONARIES[targetLocale] ?? {});

    // Pull every cached source text for this locale pair so we can mark
    // a key as "already covered by the cache".
    const cached = await db.translationCache.findMany({
      where: { sourceLocale, targetLocale },
      select: { sourceText: true, targetText: true },
    });
    const cachedByText = new Map(cached.map((c) => [c.sourceText, c.targetText]));

    const missing: Array<{ key: string; sourceText: string }> = [];
    const covered: Array<{
      key: string;
      sourceText: string;
      via: "dictionary" | "cache";
      targetText: string;
    }> = [];

    for (const [key, sourceText] of Object.entries(sourceFlat)) {
      if (key in targetFlat) {
        covered.push({
          key,
          sourceText,
          via: "dictionary",
          targetText: targetFlat[key],
        });
        continue;
      }
      const cachedTgt = cachedByText.get(sourceText);
      if (cachedTgt) {
        covered.push({
          key,
          sourceText,
          via: "cache",
          targetText: cachedTgt,
        });
        continue;
      }
      missing.push({ key, sourceText });
    }

    return NextResponse.json({
      sourceLocale,
      targetLocale,
      missing: missing.map((m) => ({
        ...m,
        keyHash: translationKey(sourceLocale, targetLocale, m.sourceText),
      })),
      covered,
      counts: {
        total: Object.keys(sourceFlat).length,
        missing: missing.length,
        covered: covered.length,
      },
    });
  } catch (error) {
    logger.error("Failed to compute missing translations", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
