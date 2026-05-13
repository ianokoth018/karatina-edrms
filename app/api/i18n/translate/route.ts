import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { translateText } from "@/lib/i18n/auto-translate";
import { logger } from "@/lib/logger";

/**
 * POST /api/i18n/translate
 * Body: { texts: string[], targetLocale: string, sourceLocale?: string }
 *
 * Returns a map of source text → translated text. Strings that couldn't be
 * translated (AI disabled, model refusal) are omitted from the map so the
 * client can fall back to the source.
 */
const MAX_TEXTS = 50;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      texts?: unknown;
      targetLocale?: unknown;
      sourceLocale?: unknown;
    };

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
    if (!Array.isArray(body.texts)) {
      return NextResponse.json(
        { error: "texts must be an array of strings" },
        { status: 400 }
      );
    }

    const texts = body.texts
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, MAX_TEXTS);

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

    return NextResponse.json({ translations });
  } catch (error) {
    logger.error("/api/i18n/translate failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
