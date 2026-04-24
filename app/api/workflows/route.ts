import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateWorkflowReference } from "@/lib/reference";
import { bootstrapWorkflow } from "@/lib/workflow-engine";

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
 *
 * Body: { templateId, documentId?, subject, formData? }
 *
 * The graph engine bootstraps from the template's start node(s) — no need
 * to supply assignees manually. The engine resolves assignees via each
 * task node's assigneeRule at runtime.
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
    const { templateId, documentId, subject, formData } = body as {
      templateId: string;
      documentId?: string;
      subject: string;
      formData?: Record<string, unknown>;
    };

    if (!templateId || !subject) {
      return NextResponse.json(
        { error: "templateId and subject are required" },
        { status: 400 }
      );
    }

    const template = await db.workflowTemplate.findUnique({ where: { id: templateId } });
    if (!template || !template.isActive) {
      return NextResponse.json({ error: "Workflow template not found or inactive" }, { status: 404 });
    }

    if (documentId) {
      const doc = await db.document.findUnique({ where: { id: documentId }, select: { id: true } });
      if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    const referenceNumber = await generateWorkflowReference();

    // Instance-level SLA: 30 days by default (individual tasks have their own per-node SLA)
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create the instance with NO tasks — the engine will create the first ones
    const instance = await db.workflowInstance.create({
      data: {
        referenceNumber,
        templateId,
        templateVersion: template.version,
        documentId: documentId ?? null,
        initiatedById: session.user.id,
        subject,
        status: "IN_PROGRESS",
        currentStepIndex: 0,
        formData: (formData ?? {}) as object,
        dueAt,
        events: {
          create: {
            eventType: "WORKFLOW_STARTED",
            actorId: session.user.id,
            data: { subject, templateName: template.name, templateVersion: template.version } as object,
          },
        },
      },
    });

    // Traverse the graph from start node(s) to create initial tasks
    const { createdTaskIds, workflowCompleted } = await bootstrapWorkflow({
      instanceId: instance.id,
      initiatorId: session.user.id,
      formData,
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_STARTED",
      resourceType: "workflow_instance",
      resourceId: instance.id,
      metadata: { referenceNumber, templateId, documentId, initialTaskCount: createdTaskIds.length },
    });

    logger.info("Workflow started via graph engine", {
      userId: session.user.id,
      instanceId: instance.id,
      initialTasks: createdTaskIds.length,
      workflowCompleted,
    });

    // Re-fetch with relations for the response
    const full = await db.workflowInstance.findUnique({
      where: { id: instance.id },
      include: {
        template: { select: { id: true, name: true } },
        tasks: {
          include: { assignee: { select: { id: true, name: true, displayName: true } } },
          orderBy: { stepIndex: "asc" },
        },
      },
    });

    return NextResponse.json(serialise({ instance: full }), { status: 201 });
  } catch (error) {
    logger.error("Failed to start workflow", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
