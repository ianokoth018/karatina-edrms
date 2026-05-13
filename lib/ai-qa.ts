import { z } from "zod";
import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/ai/config";
import { getActiveProvider } from "@/lib/ai/config";
import { getStructuredCompletion } from "@/lib/ai/provider";
import {
  buildDocumentAccessWhere,
  type SessionLike,
} from "@/lib/document-access";
import { logger } from "@/lib/logger";

/**
 * "Chat with your documents" — retrieval-augmented QA over the EDRMS
 * corpus.
 *
 * Retriever: existing Postgres FTS (idx_documents_fts on documents and
 * idx_document_files_ocr_fts on document_files.ocrText). No pgvector,
 * no extra extensions — the FTS rank is good enough to feed the LLM
 * 5ish credible candidates.
 *
 * Generator: provider-agnostic structured completion at the `balanced`
 * tier (Sonnet 4.6 / GPT-4o / Gemini 2.0 Flash) — `fast` was tried and
 * is too lossy for grounded multi-doc answers.
 *
 * Access control: every candidate is re-loaded through Prisma with the
 * caller's `buildDocumentAccessWhere`, so classification + ACL rules
 * are inherited and we never leak docs the user can't read.
 */

export interface QaCitation {
  documentId: string;
  referenceNumber: string;
  title: string;
  snippet: string;
  score: number;
}

export interface QaAnswer {
  answer: string;
  citations: QaCitation[];
  usedProvider: string | null;
}

export interface AskCorpusInput {
  question: string;
  session: SessionLike;
  /** Number of source documents to keep after access filtering. */
  k?: number;
}

const OCR_SNIPPET_MAX = 2000;
const DEFAULT_K = 5;

const SYSTEM_PROMPT = `You answer questions about an organisation's document corpus. Quote and cite document references where useful. Refuse if the corpus doesn't contain enough information.

Rules:
- The user message lists numbered sources [1], [2], ... Each carries a referenceNumber, title, and an OCR/title/description snippet.
- Ground every factual claim in the provided sources. If the sources don't answer the question, say so plainly — do not invent details.
- Cite sources inline with bracketed numbers like [1] or [2, 3]. Only cite sources whose snippets actually support the claim.
- Quote short verbatim phrases (≤ 25 words) when precision matters; paraphrase otherwise.
- Populate "citedSourceNumbers" with every source number you cite in the answer text.`;

const QaSchema = z.object({
  /** The natural-language answer with inline [n] citations. */
  answer: z.string().max(4000),
  /** 1-indexed source numbers actually referenced in `answer`. */
  citedSourceNumbers: z.array(z.number().int().min(1)).max(20),
});

interface RetrievedRow {
  id: string;
  rank: number;
  doc_rank: number | null;
  file_rank: number | null;
}

interface FileSnippetRow {
  documentId: string;
  ocrText: string | null;
}

/**
 * Run a "chat with your documents" turn.
 *
 * Returns `null` when AI is disabled so callers (API route) can map
 * that to a 503 without sprinkling provider checks everywhere.
 */
export async function askCorpus(
  input: AskCorpusInput
): Promise<QaAnswer | null> {
  if (!aiEnabled()) return null;
  const question = (input.question || "").trim();
  if (!question) return null;
  const k = Math.max(1, Math.min(20, input.k ?? DEFAULT_K));
  const overshoot = k * 4;

  // 1. FTS retrieve. Mirrors app/api/search/route.ts but trimmed for
  //    ranking only — we don't need ts_headline here since we'll pull
  //    the raw OCR text in step 4.
  let rows: RetrievedRow[] = [];
  try {
    rows = await db.$queryRawUnsafe<RetrievedRow[]>(
      `
      WITH doc_match AS (
        SELECT
          d.id,
          ts_rank(
            to_tsvector('english',
              coalesce(d.title, '') || ' ' ||
              coalesce(d.description, '') || ' ' ||
              coalesce(d."referenceNumber", '') || ' ' ||
              coalesce(d."documentType", '')
            ),
            websearch_to_tsquery('english', $1)
          ) AS doc_rank
        FROM documents d
        WHERE
          to_tsvector('english',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d."referenceNumber", '') || ' ' ||
            coalesce(d."documentType", '')
          ) @@ websearch_to_tsquery('english', $1)
          OR d.title ILIKE '%' || $1 || '%'
          OR d."referenceNumber" ILIKE '%' || $1 || '%'
      ),
      file_match AS (
        SELECT
          f."documentId" AS id,
          MAX(ts_rank(
            to_tsvector('english', coalesce(f."ocrText", '')),
            websearch_to_tsquery('english', $1)
          )) AS file_rank
        FROM document_files f
        WHERE
          to_tsvector('english', coalesce(f."ocrText", '')) @@
            websearch_to_tsquery('english', $1)
        GROUP BY f."documentId"
      )
      SELECT
        coalesce(dm.id, fm.id) AS id,
        (coalesce(dm.doc_rank, 0) + 0.3 * coalesce(fm.file_rank, 0)) AS rank,
        dm.doc_rank,
        fm.file_rank
      FROM doc_match dm
      FULL OUTER JOIN file_match fm ON dm.id = fm.id
      ORDER BY rank DESC NULLS LAST
      LIMIT $2
      `,
      question,
      overshoot
    );
  } catch (err) {
    logger.warn("askCorpus FTS failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      answer: "I couldn't search the document corpus right now. Please try again.",
      citations: [],
      usedProvider: getActiveProvider(),
    };
  }

  if (rows.length === 0) {
    return {
      answer:
        "I couldn't find any documents that match your question. Try rephrasing it or using different keywords.",
      citations: [],
      usedProvider: getActiveProvider(),
    };
  }

  // 2. Access-control filter. Re-fetch via Prisma so ACLs/classifications
  //    apply transparently.
  const accessWhere = await buildDocumentAccessWhere(input.session);
  const candidateIds = rows.map((r) => r.id);
  const allowed = await db.document.findMany({
    where: { AND: [{ id: { in: candidateIds } }, accessWhere] },
    select: {
      id: true,
      referenceNumber: true,
      title: true,
      description: true,
    },
  });
  if (allowed.length === 0) {
    return {
      answer:
        "I couldn't find any documents you have access to that match your question.",
      citations: [],
      usedProvider: getActiveProvider(),
    };
  }

  // Preserve FTS ordering and keep top-k.
  const rankByDocId = new Map(rows.map((r) => [r.id, r.rank ?? 0]));
  const allowedMap = new Map(allowed.map((d) => [d.id, d]));
  const ordered = candidateIds
    .filter((id) => allowedMap.has(id))
    .slice(0, k)
    .map((id) => ({ doc: allowedMap.get(id)!, score: rankByDocId.get(id) ?? 0 }));

  // 3. Pull OCR snippets for the kept docs (one query, then pick the
  //    best file per doc).
  const fileRows = await db.documentFile.findMany({
    where: {
      documentId: { in: ordered.map((o) => o.doc.id) },
      ocrText: { not: null },
    },
    select: { documentId: true, ocrText: true },
  });
  const ocrByDoc = new Map<string, string>();
  for (const f of fileRows as FileSnippetRow[]) {
    if (!f.ocrText) continue;
    const existing = ocrByDoc.get(f.documentId);
    // Pick the longest OCR text — it usually correlates with the
    // primary archival rendition.
    if (!existing || f.ocrText.length > existing.length) {
      ocrByDoc.set(f.documentId, f.ocrText);
    }
  }

  const citations: QaCitation[] = ordered.map((o) => {
    const ocr = ocrByDoc.get(o.doc.id) ?? "";
    const fallback = [o.doc.title, o.doc.description ?? ""].filter(Boolean).join(" — ");
    const snippet = (ocr || fallback || "").slice(0, OCR_SNIPPET_MAX);
    return {
      documentId: o.doc.id,
      referenceNumber: o.doc.referenceNumber,
      title: o.doc.title,
      snippet,
      score: o.score,
    };
  });

  // 4. Build the labelled-sources prompt and ask the LLM.
  const sourceBlock = citations
    .map(
      (c, i) =>
        `[${i + 1}] ${c.referenceNumber}: ${c.title} — ${c.snippet || "(no extracted text available)"}`
    )
    .join("\n\n");

  const userMessage = `Question: ${question}

Sources (cite as [n]):
${sourceBlock}`;

  const provider = getActiveProvider();
  const parsed = await getStructuredCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    schema: QaSchema,
    schemaName: "QaAnswer",
    tier: "balanced",
    maxTokens: 1500,
  });

  if (!parsed) {
    return {
      answer:
        "The AI provider didn't return a usable response. Please try again.",
      citations,
      usedProvider: provider,
    };
  }

  // 5. Map cited numbers back to citations. Only return citations the
  //    model actually used — keeps the UI from rendering 5 sources for
  //    a 1-source answer.
  const used = new Set(parsed.citedSourceNumbers);
  const filteredCitations =
    used.size > 0
      ? citations.filter((_, i) => used.has(i + 1))
      : citations;

  return {
    answer: parsed.answer,
    citations: filteredCitations,
    usedProvider: provider,
  };
}
