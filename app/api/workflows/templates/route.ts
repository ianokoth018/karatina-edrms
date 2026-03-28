import { NextRequest, NextResponse } from "next/server";
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
 * List all active workflow templates.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templates = await db.workflowTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
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

    return NextResponse.json(serialise({ templates }));
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
    const { name, description, steps } = body as {
      name: string;
      description?: string;
      steps: { name: string; type: "approval" | "review" }[];
    };

    if (!name || !steps?.length) {
      return NextResponse.json(
        { error: "Name and at least one step are required" },
        { status: 400 }
      );
    }

    // Validate step types
    const validTypes = ["approval", "review"];
    for (const step of steps) {
      if (!step.name || !validTypes.includes(step.type)) {
        return NextResponse.json(
          { error: "Each step must have a name and a valid type (approval or review)" },
          { status: 400 }
        );
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

    const definition = {
      steps: steps.map((step, index) => ({
        index,
        name: step.name,
        type: step.type,
      })),
    };

    const template = await db.workflowTemplate.create({
      data: {
        name,
        description: description ?? null,
        definition,
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
      metadata: { name, stepCount: steps.length },
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
