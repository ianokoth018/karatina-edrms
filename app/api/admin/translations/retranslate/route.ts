import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { translateText, translationKey } from "@/lib/i18n/auto-translate";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/translations/retranslate
 * Body:
 *   { mode: "selected", texts: string[], targetLocale: string }
 *     → Re-translate the given source strings. Existing cache rows for
 *       those strings are deleted first so `translateText` will hit the AI.
 *   { mode: "all-stale", targetLocale: string }
 *     → Wipe every non-admin-curated cache entry for `targetLocale` and
 *       leave them to repopulate on demand. Useful after editing source
 *       dictionaries.
 *
 * Admin-only. Audit-logged.
 */

const MAX_TEXTS = 50;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      mode?: unknown;
      texts?: unknown;
      targetLocale?: unknown;
      sourceLocale?: unknown;
    };

    const mode = body.mode === "all-stale" ? "all-stale" : "selected";
    const targetLocale =
      typeof body.targetLocale === "string" ? body.targetLocale : "";
    const sourceLocale =
      typeof body.sourceLocale === "string" && body.sourceLocale
        ? body.sourceLocale
        : "en";

    if (!targetLocale) {
      return NextResponse.json(
        { error: "targetLocale is required" },
        { status: 400 }
      );
    }

    if (mode === "all-stale") {
      // Drop every auto-translated row for this locale; admin-curated rows
      // (createdById not null) are preserved.
      const result = await db.translationCache.deleteMany({
        where: { targetLocale, createdById: null },
      });

      await writeAudit({
        userId: session.user.id,
        action: "TRANSLATION_CACHE_BULK_RETRANSLATE",
        resourceType: "translation_cache",
        metadata: { targetLocale, cleared: result.count },
      });

      return NextResponse.json({ ok: true, cleared: result.count });
    }

    // mode === "selected"
    if (!Array.isArray(body.texts)) {
      return NextResponse.json(
        { error: "texts must be an array of strings" },
        { status: 400 }
      );
    }
    const texts = body.texts
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, MAX_TEXTS);

    if (texts.length === 0) {
      return NextResponse.json({ translations: {} });
    }

    // Invalidate the matching rows so translateText regenerates from AI.
    const hashes = texts.map((t) => translationKey(sourceLocale, targetLocale, t));
    await db.translationCache.deleteMany({
      where: { keyHash: { in: hashes }, createdById: null },
    });

    const entries = await Promise.all(
      texts.map(async (text) => {
        const translated = await translateText({
          text,
          targetLocale,
          sourceLocale,
        });
        return [text, translated] as const;
      })
    );

    const translations: Record<string, string> = {};
    for (const [src, tgt] of entries) {
      if (tgt !== null) translations[src] = tgt;
    }

    await writeAudit({
      userId: session.user.id,
      action: "TRANSLATION_CACHE_RETRANSLATE",
      resourceType: "translation_cache",
      metadata: {
        targetLocale,
        requested: texts.length,
        translated: Object.keys(translations).length,
      },
    });

    return NextResponse.json({ translations });
  } catch (error) {
    logger.error("/api/admin/translations/retranslate failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
