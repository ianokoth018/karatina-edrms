import { createHash } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/ai/config";
import { getStructuredCompletion } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";

/**
 * LLM-backed translation fallback for strings missing from the static
 * Swahili dictionary. Source-of-truth keys still live in
 * `lib/i18n/locales/*.ts`; this module fills the gaps and caches the
 * results forever (admins can re-translate from the admin UI when the
 * source dictionary changes).
 */

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  sw: "Swahili",
};

const translationSchema = z.object({
  translation: z.string(),
});

/** sha256(sourceLocale + "|" + targetLocale + "|" + sourceText). */
export function translationKey(
  sourceLocale: string,
  targetLocale: string,
  sourceText: string
): string {
  return createHash("sha256")
    .update(`${sourceLocale}|${targetLocale}|${sourceText}`)
    .digest("hex");
}

interface TranslateOpts {
  text: string;
  targetLocale: string;
  sourceLocale?: string;
}

/**
 * Resolve a single translation. Returns:
 *   - cached target text when present
 *   - freshly-generated target text (and writes to cache) when AI is enabled
 *   - null when AI isn't configured and the cache misses
 *
 * Never throws — failures degrade to `null` so callers can fall back to the
 * source text.
 */
export async function translateText({
  text,
  targetLocale,
  sourceLocale = "en",
}: TranslateOpts): Promise<string | null> {
  if (!text) return text;
  if (sourceLocale === targetLocale) return text;

  const keyHash = translationKey(sourceLocale, targetLocale, text);

  try {
    const hit = await db.translationCache.findUnique({ where: { keyHash } });
    if (hit) return hit.targetText;
  } catch (err) {
    logger.error("translationCache lookup failed", err);
  }

  if (!aiEnabled()) return null;

  const sourceName = LOCALE_NAMES[sourceLocale] ?? sourceLocale;
  const targetName = LOCALE_NAMES[targetLocale] ?? targetLocale;

  let result: { translation: string } | null = null;
  try {
    result = await getStructuredCompletion({
      systemPrompt:
        `Translate from ${sourceName} to ${targetName}. ` +
        "Preserve placeholders like {{name}} and {0} exactly. " +
        "Use formal Kenyan administrative Swahili when translating to Swahili. " +
        "Return JSON only.",
      userMessage: text,
      schema: translationSchema,
      schemaName: "Translation",
      tier: "fast",
      maxTokens: 512,
    });
  } catch (err) {
    logger.error("translateText: AI call failed", err);
    return null;
  }

  if (!result?.translation) return null;
  const translated = result.translation.trim();

  // Fire-and-forget cache write — callers shouldn't wait on this, but we
  // also don't want unhandled rejections.
  void (async () => {
    try {
      await db.translationCache.upsert({
        where: { keyHash },
        update: {}, // never overwrite a winning row in the race
        create: {
          sourceLocale,
          targetLocale,
          sourceText: text,
          targetText: translated,
          keyHash,
        },
      });
    } catch (err) {
      logger.error("translationCache write failed", err);
    }
  })();

  return translated;
}
