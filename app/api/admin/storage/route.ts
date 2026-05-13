/**
 * GET /api/admin/storage — dashboard payload:
 *   - per-tier file counts + total bytes
 *   - list of currently-archived files (id, fileName, sizeBytes, document)
 *
 * Used by /admin/storage to render counts and the restore list.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.permissions.includes("admin:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const grouped = await db.documentFile.groupBy({
      by: ["storageTier"],
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });

    // groupBy returns rows only for tiers that exist; fill the missing ones
    // so the UI always renders three cards.
    const stats: Record<string, { count: number; totalBytes: number }> = {
      hot: { count: 0, totalBytes: 0 },
      warm: { count: 0, totalBytes: 0 },
      archive: { count: 0, totalBytes: 0 },
    };
    for (const row of grouped) {
      const tier = row.storageTier;
      if (!stats[tier]) stats[tier] = { count: 0, totalBytes: 0 };
      stats[tier].count = row._count._all;
      stats[tier].totalBytes = Number(row._sum.sizeBytes ?? BigInt(0));
    }

    const archivedFiles = await db.documentFile.findMany({
      where: { storageTier: "archive" },
      orderBy: { tierMovedAt: "desc" },
      take: 200,
      select: {
        id: true,
        fileName: true,
        sizeBytes: true,
        tierMovedAt: true,
        lastAccessedAt: true,
        document: {
          select: { id: true, title: true, referenceNumber: true },
        },
      },
    });

    return NextResponse.json({
      stats,
      archivedFiles: archivedFiles.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        sizeBytes: Number(f.sizeBytes),
        tierMovedAt: f.tierMovedAt,
        lastAccessedAt: f.lastAccessedAt,
        document: f.document,
      })),
    });
  } catch (err) {
    logger.error("storage dashboard GET failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
