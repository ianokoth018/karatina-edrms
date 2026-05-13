import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

/**
 * GET /api/admin/backup/list
 *
 * Returns the 100 most-recent BackupLog rows for the admin UI. BigInts
 * are serialised to strings so the JSON parses cleanly in the browser.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rateLimited = await enforceAdminRateLimit(req, session);
    if (rateLimited) return rateLimited;

    const rows = await db.backupLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 100,
    });

    const serialised = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      type: r.type,
      dbDumpPath: r.dbDumpPath,
      uploadsPath: r.uploadsPath,
      dbBytes: r.dbBytes != null ? r.dbBytes.toString() : null,
      uploadsBytes: r.uploadsBytes != null ? r.uploadsBytes.toString() : null,
      durationMs: r.durationMs,
      status: r.status,
      error: r.error,
    }));

    return NextResponse.json({ entries: serialised });
  } catch (err) {
    logger.error("backup.list: failed", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
