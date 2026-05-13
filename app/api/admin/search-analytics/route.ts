import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/search-analytics
 *
 * Query params:
 *   sinceDays  number — default 30
 *
 * Returns:
 *   total           total searches in window
 *   uniqueQueries   distinct query strings
 *   zeroResultRate  share of searches that returned no rows
 *   avgDurationMs
 *   topQueries      [{ query, count, avgResults }]
 *   zeroResultTop   [{ query, count }] — queries that consistently miss
 *   recent          [{ query, resultCount, occurredAt, durationMs }]
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sinceDays = Math.max(
      1,
      Math.min(365, Number(new URL(req.url).searchParams.get("sinceDays") ?? "30"))
    );
    const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);

    const [total, zeroCount, durationAgg, topQueries, zeroResultTop, recent] =
      await Promise.all([
        db.searchLog.count({ where: { occurredAt: { gte: since } } }),
        db.searchLog.count({
          where: { occurredAt: { gte: since }, hadResults: false },
        }),
        db.searchLog.aggregate({
          where: { occurredAt: { gte: since } },
          _avg: { durationMs: true, resultCount: true },
        }),
        db.searchLog.groupBy({
          by: ["query"],
          where: { occurredAt: { gte: since } },
          _count: { query: true },
          _avg: { resultCount: true },
          orderBy: { _count: { query: "desc" } },
          take: 20,
        }),
        db.searchLog.groupBy({
          by: ["query"],
          where: { occurredAt: { gte: since }, hadResults: false },
          _count: { query: true },
          orderBy: { _count: { query: "desc" } },
          take: 10,
        }),
        db.searchLog.findMany({
          where: { occurredAt: { gte: since } },
          orderBy: { occurredAt: "desc" },
          take: 30,
          select: {
            query: true,
            resultCount: true,
            durationMs: true,
            occurredAt: true,
          },
        }),
      ]);

    return NextResponse.json({
      sinceDays,
      total,
      uniqueQueries: topQueries.length,
      zeroResultRate: total > 0 ? zeroCount / total : 0,
      avgDurationMs: Math.round(durationAgg._avg.durationMs ?? 0),
      avgResultCount: Math.round(durationAgg._avg.resultCount ?? 0),
      topQueries: topQueries.map((q) => ({
        query: q.query,
        count: q._count.query,
        avgResults: Math.round(q._avg.resultCount ?? 0),
      })),
      zeroResultTop: zeroResultTop.map((q) => ({
        query: q.query,
        count: q._count.query,
      })),
      recent,
    });
  } catch (error) {
    logger.error("Failed to compute search analytics", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
