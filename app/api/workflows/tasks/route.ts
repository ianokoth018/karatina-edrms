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
 * GET /api/workflows/tasks
 * List workflow tasks for the current user.
 * Query params: status (PENDING, COMPLETED, all), page, limit
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // PENDING, COMPLETED, or omit for all
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      assigneeId: session.user.id,
    };

    if (status && status !== "all") {
      where.status = status;
    }

    const [tasks, total] = await Promise.all([
      db.workflowTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { assignedAt: "desc" },
        include: {
          instance: {
            include: {
              template: { select: { id: true, name: true } },
              document: {
                select: {
                  id: true,
                  title: true,
                  referenceNumber: true,
                  documentType: true,
                  department: true,
                },
              },
            },
          },
          assignee: {
            select: { id: true, name: true, displayName: true, email: true },
          },
        },
      }),
      db.workflowTask.count({ where }),
    ]);

    return NextResponse.json(
      serialise({
        tasks,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    logger.error("Failed to list workflow tasks", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
