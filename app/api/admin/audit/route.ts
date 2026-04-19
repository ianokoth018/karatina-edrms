import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Safely serialise BigInt values that might exist in Prisma results. */
function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/admin/audit
 * List audit log entries with optional filtering, search, and pagination.
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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));
    const skip = (page - 1) * limit;

    const userId = searchParams.get("userId") ?? undefined;
    const action = searchParams.get("action") ?? undefined;
    const resourceType = searchParams.get("resourceType") ?? undefined;
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    // Build the where clause
    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId;
    }

    if (action) {
      where.action = action;
    }

    if (resourceType) {
      where.resourceType = resourceType;
    }

    if (dateFrom || dateTo) {
      const occurredAt: Record<string, Date> = {};
      if (dateFrom) {
        occurredAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        occurredAt.lte = new Date(dateTo);
      }
      where.occurredAt = occurredAt;
    }

    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { resourceType: { contains: search, mode: "insensitive" } },
        { resourceId: { contains: search, mode: "insensitive" } },
      ];
    }

    // Run data query, count, and distinct filter values in parallel
    const [entries, total, distinctActions, distinctResourceTypes] =
      await Promise.all([
        db.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { occurredAt: "desc" },
          select: {
            id: true,
            action: true,
            resourceType: true,
            resourceId: true,
            metadata: true,
            occurredAt: true,
            ipAddress: true,
            userAgent: true,
            user: {
              select: {
                id: true,
                name: true,
                displayName: true,
                department: true,
                email: true,
              },
            },
          },
        }),
        db.auditLog.count({ where }),
        db.auditLog.findMany({
          distinct: ["action"],
          select: { action: true },
          orderBy: { action: "asc" },
        }),
        db.auditLog.findMany({
          distinct: ["resourceType"],
          select: { resourceType: true },
          orderBy: { resourceType: "asc" },
        }),
      ]);

    return NextResponse.json(
      serialise({
        entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          actions: distinctActions.map((a) => a.action),
          resourceTypes: distinctResourceTypes.map((r) => r.resourceType),
        },
      })
    );
  } catch (error) {
    logger.error("Failed to list audit logs", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
