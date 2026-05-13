import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StructuredCompletionInput, AiTier } from "@/lib/ai/provider";

/**
 * Anthropic Claude provider — uses `messages.parse()` with a
 * `json_schema` output_config so we get a typed `parsed_output` back.
 *
 * Cheap-and-fast defaults (Haiku) for `fast`; Sonnet for `balanced`;
 * Opus for `deep`. Override at the call site via `tier`.
 */

const MODELS: Record<AiTier, string> = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-4-6",
  deep: "claude-opus-4-7",
};

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 2,
    });
  }
  return client;
}

export async function getStructuredCompletion<T>(
  opts: StructuredCompletionInput<T>
): Promise<T | null> {
  const c = getClient();
  if (!c) return null;

  const tier: AiTier = opts.tier ?? "fast";
  const model = MODELS[tier];
  const maxTokens = opts.maxTokens ?? 2048;

  // System prompt is wrapped with `cache_control` so the stable prefix is
  // reused across calls. The per-call user message stays uncached.
  const response = await c.messages.parse({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: opts.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: opts.userMessage }],
    output_config: {
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(opts.schema, { target: "draft-7" }),
      },
    },
  });

  // parsed_output is null when the model refused or hit max_tokens before
  // emitting valid JSON. Treat both as "AI couldn't help" rather than a
  // hard failure.
  if (!response.parsed_output) return null;
  return opts.schema.parse(response.parsed_output);
}
