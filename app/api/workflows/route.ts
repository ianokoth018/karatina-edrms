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
 * Extract ordered task steps from a visual designer definition.
 * Traverses the node graph from start nodes via edges, collecting task nodes.
 */
function extractTasksFromDefinition(
  definition: Record<string, unknown>
): { stepIndex: number; stepName: string; assigneeRule: string; assigneeValue?: string; escalationDays?: number }[] {
  const defNodes = definition.nodes as { id: string; type: string; data: Record<string, unknown> }[] | undefined;
  const defEdges = definition.edges as { source: string; target: string }[] | undefined;

  if (!defNodes || !defEdges) return [];

  // Build adjacency map
  const adj: Record<string, string[]> = {};
  for (const e of defEdges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  const startNodes = defNodes.filter((n) => n.type === "start");
  if (startNodes.length === 0) return [];

  const visited = new Set<string>();
  const queue = [...startNodes.map((n) => n.id)];
  const tasks: { stepIndex: number; stepName: string; assigneeRule: string; assigneeValue?: string; escalationDays?: number }[] = [];
  let stepIndex = 0;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = defNodes.find((n) => n.id === currentId);
    if (!currentNode) continue;

    if (currentNode.type === "task") {
      tasks.push({
        stepIndex: stepIndex++,
        stepName: (currentNode.data.label as string) || "Untitled",
        assigneeRule: (currentNode.data.assigneeRule as string) || "dynamic",
        assigneeValue: (currentNode.data.assigneeValue as string) || undefined,
        escalationDays: (currentNode.data.escalationDays as number) || undefined,
      });
    }

    const children = adj[currentId] ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return tasks;
}

/**
 * POST /api/workflows
 * Start a new workflow instance.
 *
 * Body options:
 * 1. Explicit assignees (existing):
 *    { templateId, documentId?, subject, assignees: [{ userId, stepIndex, stepName }] }
 *
 * 2. Template-definition-driven (new):
 *    { templateId, documentId?, subject, useTemplateDefinition: true,
 *      dynamicAssignees?: { stepIndex: number; userId: string }[] }
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
    const {
      templateId,
      documentId,
      subject,
      assignees,
      useTemplateDefinition,
      dynamicAssignees,
    } = body as {
      templateId: string;
      documentId?: string;
      subject: string;
      assignees?: { userId: string; stepIndex: number; stepName: string }[];
      useTemplateDefinition?: boolean;
      dynamicAssignees?: { stepIndex: number; userId: string }[];
    };

    if (!templateId || !subject) {
      return NextResponse.json(
        { error: "templateId and subject are required" },
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

    let resolvedAssignees: { userId: string; stepIndex: number; stepName: string }[];

    if (useTemplateDefinition) {
      // Parse the template definition to auto-create tasks
      const definition = template.definition as Record<string, unknown>;
      const taskSteps = extractTasksFromDefinition(definition);

      if (taskSteps.length === 0) {
        // Fall back to legacy steps format
        const legacySteps = (definition.steps as { index: number; name: string; type: string }[] | undefined) ?? [];
        if (legacySteps.length === 0) {
          return NextResponse.json(
            { error: "Template definition has no task steps" },
            { status: 400 }
          );
        }
        // Legacy steps require explicit assignees
        if (!assignees?.length) {
          return NextResponse.json(
            { error: "Assignees are required for legacy template definitions" },
            { status: 400 }
          );
        }
        resolvedAssignees = assignees;
      } else {
        // Build dynamic assignee lookup map
        const dynamicMap = new Map<number, string>();
        if (dynamicAssignees) {
          for (const da of dynamicAssignees) {
            dynamicMap.set(da.stepIndex, da.userId);
          }
        }

        resolvedAssignees = [];
        for (const step of taskSteps) {
          let userId: string | undefined;

          if (step.assigneeRule === "specific_user" && step.assigneeValue) {
            // Verify the user exists
            const user = await db.user.findUnique({ where: { id: step.assigneeValue } });
            if (user) {
              userId = user.id;
            }
          } else if (step.assigneeRule === "role_based" && step.assigneeValue) {
            // Find a user with the specified role
            const userRole = await db.userRole.findFirst({
              where: {
                role: { name: step.assigneeValue },
                user: { isActive: true },
              },
              include: { user: { select: { id: true } } },
            });
            if (userRole) {
              userId = userRole.user.id;
            }
          } else if (step.assigneeRule === "initiator_manager") {
            // For now, fall back to the initiator (manager lookup would require org hierarchy)
            userId = session.user.id;
          }

          // Check dynamic assignees map
          if (!userId) {
            userId = dynamicMap.get(step.stepIndex);
          }

          if (!userId) {
            return NextResponse.json(
              {
                error: `No assignee could be resolved for step ${step.stepIndex} ("${step.stepName}"). Provide a dynamicAssignees entry for this step.`,
              },
              { status: 400 }
            );
          }

          resolvedAssignees.push({
            userId,
            stepIndex: step.stepIndex,
            stepName: step.stepName,
          });
        }
      }
    } else {
      // Original behavior: explicit assignees
      if (!assignees?.length) {
        return NextResponse.json(
          { error: "assignees are required when useTemplateDefinition is not set" },
          { status: 400 }
        );
      }
      resolvedAssignees = assignees;
    }

    const referenceNumber = await generateWorkflowReference();

    // Sort assignees by stepIndex
    const sortedAssignees = [...resolvedAssignees].sort(
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
          create: sortedAssignees.map((a) => ({
            stepName: a.stepName,
            stepIndex: a.stepIndex,
            assigneeId: a.userId,
            status: "PENDING" as const,
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
        assigneeCount: sortedAssignees.length,
        useTemplateDefinition: !!useTemplateDefinition,
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
