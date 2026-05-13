import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/translations/cache
 * Query: ?page=1&pageSize=50&targetLocale=sw&q=needle
 *
 * Paginated list of cached LLM translations. Admin only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? 50))
    );
    const targetLocale = url.searchParams.get("targetLocale") ?? undefined;
    const q = url.searchParams.get("q")?.trim() ?? "";

    const where = {
      ...(targetLocale ? { targetLocale } : {}),
      ...(q
        ? {
            OR: [
              { sourceText: { contains: q, mode: "insensitive" as const } },
              { targetText: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      db.translationCache.count({ where }),
      db.translationCache.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({ entries, total, page, pageSize });
  } catch (error) {
    logger.error("Failed to list translation cache", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/translations/cache?id=...
 * Removes a single cached translation so it can be regenerated on demand.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "id query parameter is required" },
        { status: 400 }
      );
    }

    const existing = await db.translationCache.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.translationCache.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "TRANSLATION_CACHE_DELETED",
      resourceType: "translation_cache",
      resourceId: id,
      metadata: {
        sourceLocale: existing.sourceLocale,
        targetLocale: existing.targetLocale,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete translation cache entry", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
