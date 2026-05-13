import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

function serialise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialise(v);
    }
    return out;
  }
  return value;
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/bulk-import/jobs/[id]/items?status=&page=&limit= — paginated
 * items view. Used by the detail page to drill into successes, skips, and
 * failures separately.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const __rateLimit = await enforceAdminRateLimit(req, session);
    if (__rateLimit) return __rateLimit;

    const { id } = await params;
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));

    const where: { jobId: string; status?: string } = { jobId: id };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      db.bulkImportItem.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sourcePath: true,
          documentId: true,
          status: true,
          error: true,
          bytes: true,
        },
      }),
      db.bulkImportItem.count({ where }),
    ]);

    return NextResponse.json(
      serialise({
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      }),
    );
  } catch (error) {
    logger.error("Failed to list bulk-import items", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
