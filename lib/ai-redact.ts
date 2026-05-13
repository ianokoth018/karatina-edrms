import { z } from "zod";
import { aiEnabled } from "@/lib/ai-client";
import { getStructuredCompletion } from "@/lib/ai/provider";

/**
 * AI-assisted PII detection for visual redaction.
 *
 * We can't ask an LLM to pinpoint visual rectangles on a PDF — that would
 * need OCR with bounding boxes. Instead we feed it the document's OCR
 * text and ask for text spans it considers sensitive. The canvas UI
 * surfaces these as a "Suggested redactions" sidebar and lets the user
 * locate + draw boxes manually.
 *
 * Uses the `fast` tier (Haiku / GPT-4o-mini / Gemini Flash) since this is
 * pattern-spotting, not reasoning.
 */

const PII_KINDS = [
  "name",
  "id_number",
  "phone",
  "email",
  "address",
  "dob",
  "account",
  "other",
] as const;

export const RedactionSuggestion = z.object({
  kind: z.enum(PII_KINDS),
  /** Verbatim text span as it appears in the OCR output. The UI uses this
   *  for Ctrl-F-style search inside the viewer. */
  text: z.string().min(1).max(400),
  /** 0–1. Below ~0.5 the UI greys the row but still shows it. */
  confidence: z.number().min(0).max(1),
  /** One-line justification e.g. "looks like a Kenyan national ID". */
  rationale: z.string().min(1).max(200),
});

export type RedactionSuggestion = z.infer<typeof RedactionSuggestion>;

const RedactionSuggestionList = z.object({
  suggestions: z.array(RedactionSuggestion).max(200),
});

const SYSTEM_PROMPT = `You scan office and government documents for personally identifiable information (PII).

Your job: return ONLY actual instances of PII that appear verbatim in the supplied OCR text. Never invent. Never paraphrase. If the document contains no PII, return an empty list.

## kind
Pick the single best match:
- name         personal full names of private individuals
- id_number    national IDs, passport numbers, KRA PIN, NHIF, NSSF, student/staff IDs
- phone        phone numbers (any format)
- email        email addresses
- address      postal or physical addresses, P.O. boxes
- dob          dates of birth or similarly identifying personal dates
- account      bank account numbers, card numbers, M-Pesa numbers
- other        any other sensitive personal data (medical, biometric, salary, etc.)

## text
The exact characters as they appear in the OCR. Preserve spacing and punctuation. Keep the span tight — a single phone number, a single name — not a whole paragraph.

## confidence
0–1, calibrated honestly:
- 0.9+  unmistakable (well-formed national ID, clearly labelled "ID No.")
- 0.6–0.8 likely PII but format is ambiguous
- 0.4–0.6 plausible
- <0.4  weak signal — still surface so the human can decide

## rationale
One short line on WHY this is sensitive (e.g. "8-digit Kenyan national ID", "private personal mobile number", "salary disclosure").

## What to SKIP
- Publicly-known names of officials acting in their official capacity (e.g. the Vice Chancellor signing a memo, a Minister named on letterhead).
- Organisation names, department names, job titles by themselves.
- Generic public phone numbers (helplines, switchboards) and corporate emails (info@, admin@).
- Document reference numbers, file codes, dates of the document itself.
- OCR noise / garbled tokens.

Return ONLY the JSON object that matches the requested schema. No prose before or after.`;

export interface DetectPiiInput {
  /** OCR text of the document. Trimmed to 16K chars before sending. */
  ocrText: string;
  /** Optional — for logging/caching keys only; not sent to the LLM. */
  documentId?: string;
}

/**
 * Detect PII text spans in the supplied OCR text.
 *
 * Returns `null` when no AI provider is configured so callers can hide the
 * feature gracefully. Returns an empty array when the model finds nothing.
 */
export async function detectPii(
  input: DetectPiiInput
): Promise<RedactionSuggestion[] | null> {
  if (!aiEnabled()) return null;

  const raw = input.ocrText || "";
  const trimmed = raw.slice(0, 16_000);
  if (!trimmed.trim()) return [];
  const truncated = raw.length > trimmed.length;

  const truncationNote = truncated
    ? "\n\n(Note: the OCR text was truncated to the first 16,000 characters; later pages are not in this excerpt.)\n"
    : "";

  const userMessage = `Document OCR text follows between <doc> tags. List every verbatim PII span you find.${truncationNote}\n\n<doc>\n${trimmed}\n</doc>`;

  const result = await getStructuredCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    schema: RedactionSuggestionList,
    schemaName: "RedactionSuggestionList",
    maxTokens: 2048,
    tier: "fast",
  });

  if (!result) return null;
  return result.suggestions;
}
