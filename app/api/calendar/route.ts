import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/calendar?month=4&year=2026 — events for a calendar month
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const year = parseInt(searchParams.get("year") ?? "", 10);

    if (!month || !year || month < 1 || month > 12 || year < 2000) {
      return NextResponse.json(
        { error: "Valid month (1-12) and year are required" },
        { status: 400 }
      );
    }

    // Date range for the queried month (inclusive)
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // 1. Workflow tasks assigned to the current user with PENDING status
    const pendingTasks = await db.workflowTask.findMany({
      where: {
        assigneeId: session.user.id,
        status: "PENDING",
        OR: [
          // Tasks that have a dueAt in this month
          {
            dueAt: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
          // Tasks assigned in this month (fallback when no dueAt)
          {
            dueAt: null,
            assignedAt: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
        ],
      },
      include: {
        instance: {
          select: { id: true, subject: true },
        },
      },
    });

    const taskEvents = pendingTasks.map((task) => ({
      id: `task-${task.id}`,
      title: `Task: ${task.stepName}`,
      date: (task.dueAt ?? task.assignedAt).toISOString(),
      type: "task" as const,
      linkUrl: `/workflows`,
      priority: task.dueAt && task.dueAt < new Date() ? "overdue" : "normal",
    }));

    // 2. Documents with retentionExpiresAt in this month
    const retentionDocs = await db.document.findMany({
      where: {
        retentionExpiresAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        status: { notIn: ["DISPOSED"] },
      },
      select: {
        id: true,
        title: true,
        referenceNumber: true,
        retentionExpiresAt: true,
      },
    });

    const retentionEvents = retentionDocs.map((doc) => ({
      id: `retention-${doc.id}`,
      title: `Retention Due: ${doc.title}`,
      date: doc.retentionExpiresAt!.toISOString(),
      type: "retention" as const,
      linkUrl: `/records/disposition`,
      priority: "normal" as const,
    }));

    // 3. Correspondence with dueDate in this month
    const correspondenceItems = await db.correspondence.findMany({
      where: {
        dueDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      select: {
        id: true,
        subject: true,
        dueDate: true,
        priority: true,
      },
    });

    const correspondenceEvents = correspondenceItems.map((c) => ({
      id: `correspondence-${c.id}`,
      title: `Correspondence Due: ${c.subject}`,
      date: c.dueDate!.toISOString(),
      type: "correspondence" as const,
      linkUrl: `/correspondence`,
      priority: c.priority === "URGENT" || c.priority === "HIGH" ? "high" : "normal",
    }));

    const events = [...taskEvents, ...retentionEvents, ...correspondenceEvents];

    return NextResponse.json({ events });
  } catch (error) {
    logger.error("Failed to fetch calendar events", error, {
      route: "/api/calendar",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
