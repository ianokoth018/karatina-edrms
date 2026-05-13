import { z } from "zod";
import { aiEnabled } from "@/lib/ai-client";
import { getStructuredCompletion } from "@/lib/ai/provider";

/**
 * AI-assisted document classification.
 *
 * Given a document's OCR text (plus optional hints like filename), Claude
 * returns a structured suggestion the user can accept, edit, or reject.
 * Uses Haiku 4.5 — extraction is cheap and structured outputs are sharp.
 *
 * The system prompt is wrapped in a `cache_control` breakpoint so the
 * prefix (~few KB of taxonomy + instructions) is reused across every
 * call without paying full input price.
 */

const DOC_TYPES = [
  "MEMO",
  "LETTER",
  "CONTRACT",
  "INVOICE",
  "RECEIPT",
  "PURCHASE_ORDER",
  "REQUISITION",
  "MINUTES",
  "REPORT",
  "POLICY",
  "FORM",
  "CERTIFICATE",
  "STUDENT_FILE",
  "STAFF_FILE",
  "OTHER",
] as const;

export const ClassificationResult = z.object({
  /** Top-level document type from a fixed taxonomy. */
  documentType: z.enum(DOC_TYPES),
  /** Suggested title (≤120 chars). Derived from headings + first lines. */
  suggestedTitle: z.string().min(1).max(120),
  /** 3–8 lowercase keyword/phrase tags. Singular, no punctuation. */
  suggestedTags: z.array(z.string().min(2).max(40)).min(0).max(8),
  /** 1–3 sentence neutral summary of what the document is. */
  summary: z.string().min(1).max(800),
  /** Free-form structured fields the model extracted — vendor name,
   *  amount, dates, reference numbers, parties, etc. Keys are
   *  snake_case; values are scalars. */
  extractedMetadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** 0–1 — how confident the model is that the classification is right.
   *  Below 0.4 the UI should show "needs review". */
  confidence: z.number().min(0).max(1),
});

export type ClassificationResult = z.infer<typeof ClassificationResult>;

const SYSTEM_PROMPT = `You classify scanned business and government documents for an Electronic Document & Records Management System (EDRMS).

Your job is to read a document's OCR text and return a single best-guess classification with a structured payload. Be conservative — when in doubt, prefer "OTHER" over a confident wrong label, and report a lower confidence.

## documentType
Pick the single best match from:
- MEMO            internal memorandum, often with TO/FROM/SUBJECT
- LETTER          formal outgoing or incoming correspondence
- CONTRACT        agreement between parties with terms and signatures
- INVOICE         bill for goods/services with line items and amounts
- RECEIPT        acknowledgement of payment
- PURCHASE_ORDER PO issued by a buyer to a supplier
- REQUISITION    internal request for goods, services, or advances
- MINUTES        meeting minutes / resolutions
- REPORT         narrative or analytical report
- POLICY         policy / SOP / procedure document
- FORM           filled-in template (leave application, claim, etc.)
- CERTIFICATE    certificate of award, completion, registration, disposal
- STUDENT_FILE   student records (admission, transcript, etc.)
- STAFF_FILE     personnel records
- OTHER          when nothing fits well

## suggestedTitle
≤ 120 chars. Prefer the document's own subject/heading if present (e.g. "RE: Renewal of ICT Maintenance Contract"). Strip noise like page numbers and OCR artefacts. Avoid generic titles like "Untitled".

## suggestedTags
3–8 lowercase keyword/phrase tags. Singular nouns or short noun phrases ("procurement", "leave application", "vendor:safaricom"). No punctuation, no hashtags, no document-type duplication.

## summary
1–3 plain-prose sentences describing what the document is and what it concerns. No bullets, no markdown. Neutral tone.

## extractedMetadata
Flat object of snake_case keys → scalar values. Extract whatever is actually present and high-confidence:
- reference_number, document_date, due_date, effective_date
- vendor_name, customer_name, party_name, signatory_name
- amount, currency
- subject, from, to, cc
- department, project, location
Skip fields the document doesn't contain. Don't fabricate values.

## confidence
0–1. Calibrate honestly:
- 0.9+ unambiguous (clearly a memo with TO/FROM/REF)
- 0.6–0.8 likely but with some uncertainty
- 0.4–0.6 best guess
- <0.4 very uncertain — the UI will flag for human review

Return ONLY the JSON object that matches the requested schema. No prose before or after.`;

export interface ClassifyInput {
  /** OCR text of the primary document file. Will be truncated to fit. */
  ocrText: string;
  /** Optional filename — sometimes carries strong signal. */
  fileName?: string;
  /** Optional caller-provided hints (department, source system, etc.). */
  hints?: Record<string, string | undefined>;
}

/**
 * Run AI classification. Returns `null` when AI is disabled (no API key)
 * so callers can degrade gracefully to manual entry. Throws on real API
 * errors — let those bubble to the caller.
 */
export async function classifyDocument(
  input: ClassifyInput
): Promise<ClassificationResult | null> {
  if (!aiEnabled()) return null;

  // OCR text from a 30-page PDF can blow past Haiku's context happily,
  // but we don't need the whole tail to classify — the first ~12K chars
  // (≈3K tokens) carries 99% of the signal for typical office docs.
  const trimmed = (input.ocrText || "").slice(0, 12_000);
  if (!trimmed.trim()) {
    return null;
  }

  const hintLines: string[] = [];
  if (input.fileName) hintLines.push(`Filename: ${input.fileName}`);
  if (input.hints) {
    for (const [k, v] of Object.entries(input.hints)) {
      if (v) hintLines.push(`${k}: ${v}`);
    }
  }
  const hintBlock = hintLines.length
    ? `\n\nUser-supplied hints (may help disambiguate):\n${hintLines.join("\n")}\n`
    : "";

  const userMessage = `${hintBlock}\nDocument OCR text follows between <doc> tags. Classify it.\n\n<doc>\n${trimmed}\n</doc>`;

  // Provider-agnostic structured-output call. The active provider
  // (Anthropic / OpenAI / Gemini) is picked from env; each one maps
  // `tier: "fast"` to its cheap-and-sharp small model. Returns null if
  // no provider is configured or the model couldn't produce valid JSON.
  return await getStructuredCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    schema: ClassificationResult,
    schemaName: "ClassificationResult",
    maxTokens: 2048,
    tier: "fast",
  });
}
