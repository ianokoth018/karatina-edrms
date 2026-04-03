import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/capture/logs -- list capture logs with filtering and pagination
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
    );
    const skip = (page - 1) * limit;

    // Build filter
    const where: Record<string, unknown> = {};
    if (profileId) {
      where.profileId = profileId;
    }
    if (status) {
      // Validate status value
      const validStatuses = [
        "PENDING",
        "PROCESSING",
        "CAPTURED",
        "DUPLICATE",
        "ERROR",
        "SKIPPED",
      ];
      if (validStatuses.includes(status.toUpperCase())) {
        where.status = status.toUpperCase();
      }
    }

    const [logs, total] = await Promise.all([
      db.captureLog.findMany({
        where,
        include: {
          profile: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.captureLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    // Serialise BigInt fields (fileSize) to strings for JSON compatibility
    const serialisedLogs = logs.map((log) => ({
      ...log,
      fileSize: log.fileSize?.toString() ?? null,
    }));

    return NextResponse.json({
      logs: serialisedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error) {
    logger.error("Failed to list capture logs", error, {
      route: "/api/capture/logs",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
