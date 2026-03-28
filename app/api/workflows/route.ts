import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateWorkflowReference } from "@/lib/reference";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/workflows
 * List workflow instances. Filter by status, template.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const templateId = searchParams.get("templateId");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      OR: [
        { initiatedById: session.user.id },
        { tasks: { some: { assigneeId: session.user.id } } },
      ],
    };
    if (status) where.status = status;
    if (templateId) where.templateId = templateId;

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
            select: {
              id: true,
              stepName: true,
              stepIndex: true,
              status: true,
              action: true,
              assignee: { select: { id: true, name: true, displayName: true } },
              assignedAt: true,
              completedAt: true,
            },
            orderBy: { stepIndex: "asc" },
          },
        },
      }),
      db.workflowInstance.count({ where }),
    ]);

    return NextResponse.json(
      serialise({
        instances,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    logger.error("Failed to list workflow instances", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workflows
 * Start a new workflow instance.
 * Body: { templateId, documentId?, subject, assignees: [{ userId, stepIndex, stepName }] }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("workflows:create")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { templateId, documentId, subject, assignees } = body as {
      templateId: string;
      documentId?: string;
      subject: string;
      assignees: { userId: string; stepIndex: number; stepName: string }[];
    };

    if (!templateId || !subject || !assignees?.length) {
      return NextResponse.json(
        { error: "templateId, subject and assignees are required" },
        { status: 400 }
      );
    }

    // Verify template exists
    const template = await db.workflowTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      return NextResponse.json(
        { error: "Workflow template not found" },
        { status: 404 }
      );
    }

    const referenceNumber = await generateWorkflowReference();

    // Sort assignees by stepIndex
    const sortedAssignees = [...assignees].sort(
      (a, b) => a.stepIndex - b.stepIndex
    );

    // Calculate due date (7 days from now)
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 7);

    const instance = await db.workflowInstance.create({
      data: {
        referenceNumber,
        templateId,
        documentId: documentId ?? null,
        initiatedById: session.user.id,
        subject,
        status: "IN_PROGRESS",
        currentStepIndex: sortedAssignees[0].stepIndex,
        dueAt,
        tasks: {
          create: sortedAssignees.map((a, idx) => ({
            stepName: a.stepName,
            stepIndex: a.stepIndex,
            assigneeId: a.userId,
            status: idx === 0 ? "PENDING" : "PENDING",
            dueAt,
          })),
        },
        events: {
          create: {
            eventType: "WORKFLOW_STARTED",
            actorId: session.user.id,
            data: { subject, templateName: template.name },
          },
        },
      },
      include: {
        template: { select: { id: true, name: true } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, displayName: true } },
          },
          orderBy: { stepIndex: "asc" },
        },
      },
    });

    // Create notification for the first assignee
    const firstAssignee = sortedAssignees[0];
    await db.notification.create({
      data: {
        userId: firstAssignee.userId,
        type: "WORKFLOW_TASK",
        title: "New workflow task assigned",
        body: `You have been assigned step "${firstAssignee.stepName}" for: ${subject}`,
        linkUrl: `/workflows`,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_STARTED",
      resourceType: "workflow_instance",
      resourceId: instance.id,
      metadata: {
        referenceNumber,
        templateId,
        documentId,
        assigneeCount: assignees.length,
      },
    });

    logger.info("Workflow started", {
      userId: session.user.id,
      action: "WORKFLOW_STARTED",
    });

    return NextResponse.json(serialise({ instance }), { status: 201 });
  } catch (error) {
    logger.error("Failed to start workflow", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
