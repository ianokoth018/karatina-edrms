import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { buildDocumentAccessWhere } from "@/lib/document-access";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/ediscovery/search
 *
 * Cross-corpus discovery search with custodian + date range + Bates filters.
 * Audited; respects buildDocumentAccessWhere.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const custodianIds = (searchParams.get("custodianIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const documentType = searchParams.get("documentType");
    const department = searchParams.get("department");
    const batesProductionId = searchParams.get("batesProductionId");
    const hasBates = searchParams.get("hasBates");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));
    const skip = (page - 1) * limit;

    const accessWhere = await buildDocumentAccessWhere(session);

    const filters: Record<string, unknown>[] = [];
    if (q) {
      filters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { referenceNumber: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { files: { some: { ocrText: { contains: q, mode: "insensitive" } } } },
        ],
      });
    }
    if (custodianIds.length) filters.push({ createdById: { in: custodianIds } });
    if (documentType) filters.push({ documentType });
    if (department) filters.push({ department });
    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
      filters.push({ createdAt });
    }
    if (batesProductionId) {
      filters.push({ bates: { some: { productionId: batesProductionId } } });
    } else if (hasBates === "true") {
      filters.push({ bates: { some: {} } });
    } else if (hasBates === "false") {
      filters.push({ bates: { none: {} } });
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
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: { select: { id: true, name: true, displayName: true } },
          bates: {
            include: { production: { select: { id: true, name: true } } },
          },
        },
      }),
      db.document.count({ where }),
    ]);

    await writeAudit({
      userId: session.user.id,
      action: "ediscovery.search",
      resourceType: "Document",
      metadata: {
        q,
        custodianIds,
        dateFrom,
        dateTo,
        documentType,
        department,
        batesProductionId,
        hasBates,
        resultCount: total,
      },
    });

    return NextResponse.json(
      serialise({
        documents,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    logger.error("eDiscovery search failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
