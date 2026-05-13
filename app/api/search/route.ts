import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import { rewriteSearchQuery } from "@/lib/ai-search";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    let department = searchParams.get("department");
    let type = searchParams.get("type");
    let status = searchParams.get("status");
    let dateFrom = searchParams.get("dateFrom");
    let dateTo = searchParams.get("dateTo");
    const useAi = searchParams.get("ai") === "1";
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") ?? "20"))
    );
    const skip = (page - 1) * limit;

    const accessWhere = await buildDocumentAccessWhere(session);

    let aiRewrite: Awaited<ReturnType<typeof rewriteSearchQuery>> = null;
    let effectiveQ = q;
    if (useAi && q) {
      try {
        aiRewrite = await rewriteSearchQuery({ query: q });
        if (aiRewrite) {
          if (!department && aiRewrite.department) department = aiRewrite.department;
          if (!type && aiRewrite.type) type = aiRewrite.type;
          if (!status && aiRewrite.status) status = aiRewrite.status;
          if (!dateFrom && aiRewrite.dateFrom) dateFrom = aiRewrite.dateFrom;
          if (!dateTo && aiRewrite.dateTo) dateTo = aiRewrite.dateTo;
          effectiveQ = (aiRewrite.fts_query ?? "").trim() || q;
        }
      } catch (e) {
        logger.warn("AI search rewrite failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let rankedIds: string[] | null = null;
    const headlines = new Map<string, { title?: string; ocr?: string }>();
    if (effectiveQ) {
      const rows: Array<{
        id: string;
        rank: number;
        title_hl: string | null;
        ocr_hl: string | null;
      }> = await db.$queryRawUnsafe(
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
            ) AS doc_rank,
            ts_headline(
              'english',
              coalesce(d.title, ''),
              websearch_to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxFragments=1, MaxWords=15, MinWords=3'
            ) AS title_hl
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
            )) AS file_rank,
            (array_agg(ts_headline(
              'english',
              coalesce(f."ocrText", ''),
              websearch_to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=20, MinWords=5'
            )))[1] AS ocr_hl
          FROM document_files f
          WHERE
            to_tsvector('english', coalesce(f."ocrText", '')) @@
              websearch_to_tsquery('english', $1)
          GROUP BY f."documentId"
        )
        SELECT
          coalesce(dm.id, fm.id) AS id,
          (coalesce(dm.doc_rank, 0) + 0.3 * coalesce(fm.file_rank, 0)) AS rank,
          dm.title_hl,
          fm.ocr_hl
        FROM doc_match dm
        FULL OUTER JOIN file_match fm ON dm.id = fm.id
        ORDER BY rank DESC NULLS LAST
        LIMIT 500
        `,
        effectiveQ
      );
      rankedIds = rows.map((r) => r.id);
      for (const r of rows) {
        headlines.set(r.id, {
          title: r.title_hl ?? undefined,
          ocr: r.ocr_hl ?? undefined,
        });
      }
    }

    const filters: Record<string, unknown>[] = [];
    if (rankedIds) filters.push({ id: { in: rankedIds } });
    if (department) filters.push({ department });
    if (type) filters.push({ documentType: type });
    if (status) filters.push({ status });
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
      filters.push({ createdAt });
    }
    const where =
      Object.keys(accessWhere).length > 0
        ? filters.length
          ? { AND: [accessWhere, ...filters] }
          : accessWhere
        : filters.length
          ? { AND: filters }
          : {};

    const [documents, total] = await Promise.all([
      db.document.findMany({
        where,
        skip: rankedIds ? 0 : skip,
        take: rankedIds ? Math.min(500, limit * page) : limit,
        orderBy: rankedIds ? undefined : { createdAt: "desc" },
        include: {
          tags: { select: { tag: true } },
          createdBy: { select: { id: true, name: true, displayName: true } },
          classificationNode: { select: { id: true, code: true, title: true } },
          files: {
            where: { ocrText: { not: null } },
            select: { id: true, fileName: true, ocrStatus: true },
            take: 1,
          },
        },
      }),
      db.document.count({ where }),
    ]);

    let ordered = documents;
    if (rankedIds) {
      const order = new Map(rankedIds.map((id, i) => [id, i]));
      ordered = [...documents].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      );
      ordered = ordered.slice(skip, skip + limit);
    }

    const facetWhere =
      Object.keys(accessWhere).length > 0 ? accessWhere : undefined;
    const [departments, types, statuses] = await Promise.all([
      db.document.groupBy({
        by: ["department"],
        where: facetWhere,
        _count: { department: true },
        orderBy: { _count: { department: "desc" } },
      }),
      db.document.groupBy({
        by: ["documentType"],
        where: facetWhere,
        _count: { documentType: true },
        orderBy: { _count: { documentType: "desc" } },
      }),
      db.document.groupBy({
        by: ["status"],
        where: facetWhere,
        _count: { status: true },
        orderBy: { _count: { status: "desc" } },
      }),
    ]);

    const results = ordered.map((doc) => {
      const hl = headlines.get(doc.id);
      const ocrFile = doc.files?.[0];
      return {
        ...doc,
        _highlight: {
          title: hl?.title ?? doc.title,
          ocrSnippet: hl?.ocr ?? null,
          ocrFileName: hl?.ocr ? ocrFile?.fileName : null,
        },
      };
    });

    const durationMs = Date.now() - startedAt;
    if (q) {
      db.searchLog
        .create({
          data: {
            userId: session.user.id,
            query: q,
            filters: {
              department: department ?? null,
              type: type ?? null,
              status: status ?? null,
              dateFrom: dateFrom ?? null,
              dateTo: dateTo ?? null,
            } as object,
            resultCount: total,
            durationMs,
            hadResults: total > 0,
          },
        })
        .catch((err) =>
          logger.warn("Failed to write SearchLog", { err: String(err) })
        );
    }

    return NextResponse.json(
      serialise({
        results,
        query: q,
        effectiveQuery: effectiveQ,
        aiRewrite,
        durationMs,
        facets: {
          departments: departments.map((d) => ({
            value: d.department,
            count: d._count.department,
          })),
          types: types.map((t) => ({
            value: t.documentType,
            count: t._count.documentType,
          })),
          statuses: statuses.map((s) => ({
            value: s.status,
            count: s._count.status,
          })),
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    logger.error("Search failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
