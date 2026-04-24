import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/**
 * GET /api/workflows/monitor
 * Admin-only live view of all workflow instances with pending task counts.
 * Supports filtering by status, templateId, search, and pagination.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "25")));
    const skip = (page - 1) * limit;
    const status = searchParams.get("status") ?? undefined;
    const templateId = searchParams.get("templateId") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const statusWhere: Prisma.WorkflowInstanceWhereInput = status
      ? { status: status as Prisma.EnumWorkflowStatusFilter }
      : { status: { in: ["PENDING", "IN_PROGRESS"] } };

    const where: Prisma.WorkflowInstanceWhereInput = {
      ...statusWhere,
      ...(templateId ? { templateId } : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: "insensitive" } },
              { referenceNumber: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [instances, total] = await Promise.all([
      db.workflowInstance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: "desc" },
        include: {
          template: { select: { id: true, name: true } },
          document: { select: { id: true, title: true, referenceNumber: true } },
          tasks: {
            where: { status: "PENDING" },
            select: {
              id: true,
              stepName: true,
              dueAt: true,
              assigneeId: true,
              poolId: true,
              escalationLevel: true,
              assignee: { select: { id: true, name: true, displayName: true, email: true } },
            },
          },
          _count: { select: { tasks: true } },
        },
      }),
      db.workflowInstance.count({ where }),
    ]);

    // Batch-fetch initiators
    const initiatorIds = [...new Set(instances.map((i) => i.initiatedById))];
    const initiators = await db.user.findMany({
      where: { id: { in: initiatorIds } },
      select: { id: true, name: true, displayName: true, email: true },
    });
    const initiatorMap = new Map(initiators.map((u) => [u.id, u]));

    const now = new Date();
    const enriched = instances.map((inst) => ({
      ...inst,
      initiatedBy: initiatorMap.get(inst.initiatedById) ?? {
        id: inst.initiatedById, name: "Unknown", displayName: null, email: "",
      },
      overdueTaskCount: inst.tasks.filter(
        (t: { dueAt: Date | null }) => t.dueAt && new Date(t.dueAt) < now
      ).length,
    }));

    return NextResponse.json(serialise({
      instances: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }));
  } catch (error) {
    logger.error("Failed to load workflow monitor", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
