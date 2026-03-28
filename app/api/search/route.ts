import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * Highlight search terms in a string by wrapping matches in <mark> tags.
 */
function highlight(text: string | null | undefined, query: string): string {
  if (!text || !query) return text ?? "";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
}

/**
 * Extract a snippet around the first occurrence of the query in the text.
 */
function snippet(
  text: string | null | undefined,
  query: string,
  maxLen = 200
): string {
  if (!text || !query) return text?.slice(0, maxLen) ?? "";
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);

  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + query.length + 80);
  let result = text.slice(start, end);
  if (start > 0) result = "..." + result;
  if (end < text.length) result = result + "...";
  return result;
}

/**
 * GET /api/search
 * Full-text search across documents.
 * Query params:
 *   q          - search query (required)
 *   department - filter by department
 *   type       - filter by document type
 *   status     - filter by document status
 *   dateFrom   - filter by creation date (from)
 *   dateTo     - filter by creation date (to)
 *   page       - page number (default 1)
 *   limit      - items per page (default 20)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const department = searchParams.get("department");
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // Full-text search: search by title, description, reference number, tags, document type
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { referenceNumber: { contains: q, mode: "insensitive" } },
        { documentType: { contains: q, mode: "insensitive" } },
        { tags: { some: { tag: { contains: q, mode: "insensitive" } } } },
      ];
    }

    // Filters
    if (department) {
      where.department = department;
    }
    if (type) {
      where.documentType = type;
    }
    if (status) {
      where.status = status;
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
    }

    const [documents, total] = await Promise.all([
      db.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          tags: { select: { tag: true } },
          createdBy: {
            select: { id: true, name: true, displayName: true },
          },
          classificationNode: {
            select: { id: true, code: true, title: true },
          },
        },
      }),
      db.document.count({ where }),
    ]);

    // Get facet counts for the sidebar filters
    const [departments, types, statuses] = await Promise.all([
      db.document.groupBy({
        by: ["department"],
        _count: { department: true },
        orderBy: { _count: { department: "desc" } },
      }),
      db.document.groupBy({
        by: ["documentType"],
        _count: { documentType: true },
        orderBy: { _count: { documentType: "desc" } },
      }),
      db.document.groupBy({
        by: ["status"],
        _count: { status: true },
        orderBy: { _count: { status: "desc" } },
      }),
    ]);

    // Enrich results with highlighting
    const results = documents.map((doc) => ({
      ...doc,
      _highlight: {
        title: highlight(doc.title, q),
        description: snippet(doc.description, q),
        referenceNumber: highlight(doc.referenceNumber, q),
      },
    }));

    return NextResponse.json(
      serialise({
        results,
        query: q,
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
