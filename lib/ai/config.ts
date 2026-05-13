import type { AiProvider } from "@/lib/ai/provider";

/**
 * Active-provider selection.
 *
 * Resolution order:
 *   1. `AI_PROVIDER` env var (explicit override) — must match a configured key
 *      to actually take effect. If the var is set but the matching key is
 *      missing we fall through to auto-detect (don't silently 500).
 *   2. Auto-detect — first key found in {anthropic, openai, gemini}.
 *   3. `null` when no provider is configured.
 */

function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function hasOpenAiKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function hasGeminiKey(): boolean {
  // The official `@google/genai` README uses GEMINI_API_KEY; accept
  // GOOGLE_API_KEY too because that's what GCP-leaning users tend to set.
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function providerHasKey(p: AiProvider): boolean {
  switch (p) {
    case "anthropic":
      return hasAnthropicKey();
    case "openai":
      return hasOpenAiKey();
    case "gemini":
      return hasGeminiKey();
  }
}

function readEnvProvider(): AiProvider | null {
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (raw === "anthropic" || raw === "openai" || raw === "gemini") {
    return raw;
  }
  return null;
}

/** Returns the active provider, or `null` if none is configured. */
export function getActiveProvider(): AiProvider | null {
  const env = readEnvProvider();
  if (env && providerHasKey(env)) return env;

  if (hasAnthropicKey()) return "anthropic";
  if (hasOpenAiKey()) return "openai";
  if (hasGeminiKey()) return "gemini";
  return null;
}

/** True when ANY provider has a usable key configured. */
export function aiEnabled(): boolean {
  return getActiveProvider() !== null;
}
