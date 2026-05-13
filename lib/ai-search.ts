import { z } from "zod";
import { aiEnabled } from "@/lib/ai-client";
import { getStructuredCompletion } from "@/lib/ai/provider";

/**
 * Natural-language search query rewriter.
 *
 * Takes a free-form question like "all contracts with Vendor X signed in
 * the last 6 months over KES 5M" and returns structured facet filters
 * plus a tightened FTS query string that the existing /api/search route
 * can apply.
 *
 * Uses Haiku 4.5 — this is a small structured-extraction task. Caches
 * the (large) system prompt prefix so repeat searches pay close to zero
 * for the instructions/taxonomy portion.
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

const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED", "DISPOSED", "CHECKED_OUT"] as const;

export const SearchRewriteResult = z.object({
  /** Tightened query string for the FTS phase. Should preserve user
   *  intent but strip filter-ish text (e.g. drop "last 6 months" once
   *  it's captured in dateFrom). Empty string is allowed when the
   *  query is *entirely* expressible as facets. */
  fts_query: z.string().max(500),
  /** Facet: department exact match. */
  department: z.string().max(80).nullable().optional(),
  /** Facet: documentType — must be one of the canonical values. */
  type: z.enum(DOC_TYPES).nullable().optional(),
  /** Facet: workflow/document status. */
  status: z.enum(STATUSES).nullable().optional(),
  /** Inclusive lower bound, YYYY-MM-DD. */
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Inclusive upper bound, YYYY-MM-DD. */
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Short explanation of how the original query was decomposed. Shown
   *  in the UI under the search bar so the user can verify the
   *  interpretation before trusting results. */
  explanation: z.string().max(280),
});

export type SearchRewriteResult = z.infer<typeof SearchRewriteResult>;

const SYSTEM_PROMPT = `You translate natural-language search requests into structured filters for an EDRMS search API.

The API accepts these facet parameters:
- department  exact string match against a department name
- type        canonical document type: MEMO | LETTER | CONTRACT | INVOICE | RECEIPT | PURCHASE_ORDER | REQUISITION | MINUTES | REPORT | POLICY | FORM | CERTIFICATE | STUDENT_FILE | STAFF_FILE | OTHER
- status      DRAFT | ACTIVE | ARCHIVED | DISPOSED | CHECKED_OUT
- dateFrom    inclusive lower bound, YYYY-MM-DD
- dateTo      inclusive upper bound, YYYY-MM-DD
- fts_query   the remaining text that should drive the Postgres full-text search phase

## Rewriting rules
1. Pull any clearly-expressed facet out of the natural-language query and into the appropriate field. Leave the rest as fts_query.
2. Use the current date (provided in the user message) to resolve relative time expressions:
   - "today", "yesterday", "this week", "last week", "this month", "last 30 days", "last 6 months", "last year", "since January", "before 2024-06-15", "between Jan and March", etc.
3. Map common synonyms onto the canonical type list (e.g. "PO" → PURCHASE_ORDER, "agreement" → CONTRACT, "bill" → INVOICE, "memo" → MEMO).
4. Status mapping: "open" → ACTIVE, "archived/closed" → ARCHIVED, "disposed/destroyed" → DISPOSED.
5. If the user names a vendor, person, or amount, leave it inside fts_query — those aren't facets.
6. fts_query should be tightened, not echoed verbatim. Drop temporal phrases the dates capture. Keep proper nouns and content keywords.
7. Set a facet to null when you're unsure — better to widen the search than to misclassify.
8. Always populate an "explanation" (≤ 280 chars) describing how you split the query.

## Examples (do not echo)

Input: "all contracts with Acme signed in the last 6 months over 5M"
Today: 2026-03-14
Output:
{
  "fts_query": "Acme over 5M",
  "type": "CONTRACT",
  "dateFrom": "2025-09-14",
  "dateTo": "2026-03-14",
  "explanation": "type=CONTRACT, last 6 months → 2025-09-14..2026-03-14, free text 'Acme over 5M' goes to FTS."
}

Input: "open POs from procurement this year"
Today: 2026-03-14
Output:
{
  "fts_query": "",
  "type": "PURCHASE_ORDER",
  "status": "ACTIVE",
  "department": "procurement",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-12-31",
  "explanation": "PO→PURCHASE_ORDER, open→ACTIVE, department=procurement, this year (2026)."
}

Input: "leave forms"
Output:
{
  "fts_query": "leave",
  "type": "FORM",
  "explanation": "FORM facet + 'leave' to FTS."
}

Return ONLY the JSON object matching the schema. No prose.`;

export interface RewriteInput {
  query: string;
  /** Override the date used to resolve relative expressions. Defaults
   *  to today in YYYY-MM-DD. Useful for tests and replays. */
  today?: string;
}

/**
 * Rewrite a natural-language query into structured facet filters. Returns
 * `null` when AI is disabled so callers fall through to a raw FTS query.
 */
export async function rewriteSearchQuery(
  input: RewriteInput
): Promise<SearchRewriteResult | null> {
  if (!aiEnabled()) return null;
  const q = (input.query || "").trim();
  if (!q) return null;

  const today =
    input.today ??
    new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Provider-agnostic structured-output call. Active provider is picked
  // from env (Anthropic / OpenAI / Gemini); each maps `tier: "fast"` to
  // its cheap small model — search rewrites don't need a top-tier brain.
  return await getStructuredCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Today: ${today}\nQuery: ${q}`,
    schema: SearchRewriteResult,
    schemaName: "SearchRewriteResult",
    maxTokens: 600,
    tier: "fast",
  });
}
