import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/workflows/templates
 * List workflow templates.  Pass ?all=true to include inactive ones.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const showAll =
      req.nextUrl.searchParams.get("all") === "true" &&
      session.user.permissions.includes("workflows:manage");

    const templates = await db.workflowTemplate.findMany({
      where: showAll ? {} : { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        version: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { instances: true } },
      },
    });

    // Also fetch aggregate instance stats per template
    const instanceStats = await db.workflowInstance.groupBy({
      by: ["templateId", "status"],
      _count: { id: true },
    });

    const statsMap: Record<
      string,
      { total: number; completed: number }
    > = {};
    for (const row of instanceStats) {
      if (!statsMap[row.templateId]) {
        statsMap[row.templateId] = { total: 0, completed: 0 };
      }
      statsMap[row.templateId].total += row._count.id;
      if (row.status === "COMPLETED") {
        statsMap[row.templateId].completed += row._count.id;
      }
    }

    const enriched = templates.map((t) => ({
      ...t,
      instanceCount: t._count.instances,
      completedInstances: statsMap[t.id]?.completed ?? 0,
    }));

    return NextResponse.json(serialise({ templates: enriched }));
  } catch (error) {
    logger.error("Failed to list workflow templates", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workflows/templates
 * Create a new workflow template.
 * Body: { name, description, steps: [{ name: string, type: "approval" | "review" }] }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, description, steps, definition: rawDefinition } = body as {
      name: string;
      description?: string;
      steps?: { name: string; type: "approval" | "review" }[];
      definition?: Record<string, unknown>;
    };

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Must have either steps or a full definition from the designer
    if (!steps?.length && !rawDefinition) {
      return NextResponse.json(
        { error: "At least one step or a workflow definition is required" },
        { status: 400 }
      );
    }

    // Validate step types if steps are provided
    if (steps?.length) {
      const validTypes = ["approval", "review", "notification"];
      for (const step of steps) {
        if (!step.name || !validTypes.includes(step.type)) {
          return NextResponse.json(
            { error: "Each step must have a name and a valid type (approval, review, or notification)" },
            { status: 400 }
          );
        }
      }
    }

    // Check for duplicate name
    const existing = await db.workflowTemplate.findUnique({
      where: { name },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A template with this name already exists" },
        { status: 409 }
      );
    }

    // If a full definition was provided (from the visual designer), use it.
    // Otherwise, build one from the steps array.
    const definition = rawDefinition ?? {
      steps: (steps ?? []).map((step, index) => ({
        index,
        name: step.name,
        type: step.type,
      })),
    };

    const template = await db.workflowTemplate.create({
      data: {
        name,
        description: description ?? null,
        definition: definition as Prisma.InputJsonValue,
        createdById: session.user.id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        version: true,
        isActive: true,
        createdAt: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_CREATED",
      resourceType: "workflow_template",
      resourceId: template.id,
      metadata: { name, stepCount: steps?.length ?? 0 },
    });

    logger.info("Workflow template created", {
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_CREATED",
    });

    return NextResponse.json(serialise({ template }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create workflow template", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
