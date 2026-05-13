import type { z } from "zod";

/**
 * Provider-agnostic interface for structured LLM completions.
 *
 * Each provider (Anthropic, OpenAI, Gemini) implements
 * `getStructuredCompletion` to coerce model output through a zod schema and
 * return a typed result. `getStructuredCompletion` here is the dispatcher
 * that picks the active provider from env and delegates.
 */

export type AiProvider = "anthropic" | "openai" | "gemini";

export type AiTier = "fast" | "balanced" | "deep";

export interface StructuredCompletionInput<T> {
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodType<T>;
  /** Schema name — surfaces in OpenAI's `response_format.json_schema.name`
   *  and is harmless elsewhere. Keep it `PascalCase` and stable per call
   *  site so caches can key on it. */
  schemaName: string;
  /** Default 2048. */
  maxTokens?: number;
  /** Tier hint — provider-specific model mapping lives in each impl. */
  tier?: AiTier;
}

export type GetStructuredCompletion = <T>(
  opts: StructuredCompletionInput<T>
) => Promise<T | null>;

/**
 * Dispatch a structured completion to the configured provider.
 *
 * Returns `null` when no provider is configured (missing key) so callers
 * can degrade gracefully — same contract as the old single-provider helper.
 */
export async function getStructuredCompletion<T>(
  opts: StructuredCompletionInput<T>
): Promise<T | null> {
  // Lazy-import the config + providers so loading this module doesn't
  // force-eager any SDKs we won't end up using.
  const { getActiveProvider } = await import("@/lib/ai/config");
  const provider = getActiveProvider();
  if (!provider) return null;

  switch (provider) {
    case "anthropic": {
      const { getStructuredCompletion: run } = await import(
        "@/lib/ai/providers/anthropic"
      );
      return run(opts);
    }
    case "openai": {
      const { getStructuredCompletion: run } = await import(
        "@/lib/ai/providers/openai"
      );
      return run(opts);
    }
    case "gemini": {
      const { getStructuredCompletion: run } = await import(
        "@/lib/ai/providers/gemini"
      );
      return run(opts);
    }
  }
}
