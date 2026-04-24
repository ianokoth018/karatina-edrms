import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/**
 * GET /api/workflows/pool-tasks
 * List all PENDING unclaimed pool tasks for pools the current user belongs to.
 * Admins with workflows:manage see all pool tasks.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;
    const isAdmin = session.user.permissions.includes("workflows:manage") || session.user.roles.includes("Admin");

    // Find pools this user belongs to
    const userPools = await db.workflowPoolMember.findMany({
      where: { userId: session.user.id },
      select: { poolId: true },
    });
    const poolIds = userPools.map((p) => p.poolId);

    const where = {
      status: "PENDING" as const,
      poolId: isAdmin ? { not: null as unknown as string } : { in: poolIds },
      claimedById: null,
    };

    const [tasks, total] = await Promise.all([
      db.workflowTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }],
        include: {
          pool: { select: { id: true, name: true } },
          instance: {
            include: {
              template: { select: { id: true, name: true } },
              document: { select: { id: true, title: true, referenceNumber: true } },
            },
          },
        },
      }),
      db.workflowTask.count({ where }),
    ]);

    return NextResponse.json(serialise({
      tasks,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }));
  } catch (error) {
    logger.error("Failed to list pool tasks", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
