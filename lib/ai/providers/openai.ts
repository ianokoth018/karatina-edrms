import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { StructuredCompletionInput, AiTier } from "@/lib/ai/provider";

/**
 * OpenAI GPT provider — uses `chat.completions.parse()` with a
 * zod-derived `response_format: { type: "json_schema", ... }` so the
 * model is constrained to emit a schema-conformant payload.
 *
 * `gpt-4o-mini` for `fast`; `gpt-4o` for `balanced`/`deep`. (Until a
 * clearly-better-priced "deep" option lands, paying for the same
 * top-of-line model on `deep` is fine.)
 */

const MODELS: Record<AiTier, string> = {
  fast: "gpt-4o-mini",
  balanced: "gpt-4o",
  deep: "gpt-4o",
};

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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

  const completion = await c.chat.completions.parse({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage },
    ],
    response_format: zodResponseFormat(opts.schema, opts.schemaName),
  });

  // `parsed` is null when the model refused or hit max_tokens before
  // emitting valid JSON — treat as "AI couldn't help" rather than a
  // hard failure (matches the Anthropic provider's behaviour).
  const parsed = completion.choices[0]?.message?.parsed;
  if (parsed == null) return null;
  return opts.schema.parse(parsed);
}
