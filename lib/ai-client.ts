import Anthropic from "@anthropic-ai/sdk";
import { aiEnabled as anyProviderEnabled } from "@/lib/ai/config";

/**
 * Backward-compat surface for the original single-provider client.
 *
 * New code should go through `lib/ai/provider.ts` (`getStructuredCompletion`)
 * which transparently picks the configured provider — Anthropic, OpenAI,
 * or Gemini. The exports here remain so existing imports keep working,
 * but `aiEnabled` now reflects ANY configured provider, not just
 * Anthropic.
 *
 * `aiClient` is preserved as a raw Anthropic handle for callers that
 * still want direct SDK access (e.g. streaming or non-structured calls).
 */
export const aiClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 2,
});

/** Returns true when ANY supported AI provider is configured. */
export function aiEnabled(): boolean {
  return anyProviderEnabled();
}

/**
 * Model presets. Defaults are cheap-and-fast (Haiku) so callers must
 * opt-in to Sonnet/Opus only when the task genuinely needs them.
 */
export const AI_MODELS = {
  /** Cheap + fast — use for structured-output extraction, NL rewrites,
   *  classification. ~$1/1M in, ~$5/1M out. 200K context. */
  fast: "claude-haiku-4-5" as const,
  /** Balanced — only when fast can't reason well enough. */
  balanced: "claude-sonnet-4-6" as const,
  /** Top-of-line — only when correctness >>> cost. */
  deep: "claude-opus-4-7" as const,
};

export type AiModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];
