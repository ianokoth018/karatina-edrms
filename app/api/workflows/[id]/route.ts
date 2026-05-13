import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow instance with its tasks.
 * Accessible to the instance initiator or any task assignee.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const instance = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, name: true, description: true, definition: true } },
        document: { select: { id: true, title: true, referenceNumber: true, documentType: true } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, displayName: true, email: true } },
            claimedBy: { select: { id: true, name: true, displayName: true } },
          },
          orderBy: { stepIndex: "asc" },
        },
      },
    });

    if (!instance) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const userId = session.user.id;
    const isInitiator = instance.initiatedById === userId;
    const isAssignee = instance.tasks.some(
      (t) => t.assigneeId === userId || t.claimedById === userId
    );
    const isAdmin = (session.user.permissions as string[]).some((p) =>
      ["workflows:manage", "admin:all"].includes(p)
    );

    if (!isInitiator && !isAssignee && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch initiator separately (no Prisma relation on the model)
    const initiator = await db.user.findUnique({
      where: { id: instance.initiatedById },
      select: { id: true, name: true, displayName: true, email: true, department: true },
    });

    return NextResponse.json(serialise({ instance: { ...instance, initiatedBy: initiator } }));
  } catch (error) {
    logger.error("Failed to fetch workflow instance", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
