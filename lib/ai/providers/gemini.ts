import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { StructuredCompletionInput, AiTier } from "@/lib/ai/provider";

/**
 * Google Gemini provider — uses `ai.models.generateContent` with
 * `responseJsonSchema` + `responseMimeType: "application/json"` so the
 * model is forced into JSON-mode against our zod-derived schema.
 *
 * `gemini-2.0-flash` for `fast`/`balanced`; `gemini-2.0-pro-exp` for
 * `deep`. (Pro-exp is the cheapest sensible "deep" tier today; bump
 * to a stable Pro when one ships.)
 */

const MODELS: Record<AiTier, string> = {
  fast: "gemini-2.0-flash",
  balanced: "gemini-2.0-flash",
  deep: "gemini-2.0-pro-exp",
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new GoogleGenAI({ apiKey });
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

  // Gemini's `responseSchema` only accepts an OpenAPI subset, but
  // `responseJsonSchema` accepts full JSON Schema — which is what
  // `z.toJSONSchema` produces. Use the latter.
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" });

  // Gemini doesn't natively split system vs user roles, so we prepend
  // the system prompt to the user message. Models still respect the
  // pseudo-instruction block.
  const composed = `${opts.systemPrompt}\n\n---\n\n${opts.userMessage}`;

  const response = await c.models.generateContent({
    model,
    contents: composed,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      maxOutputTokens: maxTokens,
    },
  });

  const text = response.text;
  if (!text) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Model emitted JSON-ish noise we can't parse — degrade gracefully.
    return null;
  }
  // zod will throw on shape mismatch; the consumer-level error handler
  // already treats those as 500s — matches Anthropic/OpenAI behaviour.
  return opts.schema.parse(raw);
}
