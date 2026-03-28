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
 * GET /api/workflows/templates/[id]
 * Fetch a single workflow template with its full definition.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const template = await db.workflowTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        version: true,
        isActive: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(serialise({ template }));
  } catch (error) {
    logger.error("Failed to fetch workflow template", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/workflows/templates/[id]
 * Update a workflow template (name, description, definition, isActive).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.workflowTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { name, description, definition, isActive } = body as {
      name?: string;
      description?: string;
      definition?: Record<string, unknown>;
      isActive?: boolean;
    };

    // If name is being changed, check for duplicate
    if (name && name !== existing.name) {
      const duplicate = await db.workflowTemplate.findUnique({
        where: { name },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A template with this name already exists" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (definition !== undefined) {
      updateData.definition = definition;
      updateData.version = existing.version + 1;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    const template = await db.workflowTemplate.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        version: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_UPDATED",
      resourceType: "workflow_template",
      resourceId: template.id,
      metadata: {
        name: template.name,
        version: template.version,
        updatedFields: Object.keys(updateData),
      },
    });

    logger.info("Workflow template updated", {
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_UPDATED",
    });

    return NextResponse.json(serialise({ template }));
  } catch (error) {
    logger.error("Failed to update workflow template", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workflows/templates/[id]
 * Soft-delete a template by setting isActive to false.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.workflowTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    await db.workflowTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_DEACTIVATED",
      resourceType: "workflow_template",
      resourceId: id,
      metadata: { name: existing.name },
    });

    logger.info("Workflow template deactivated", {
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_DEACTIVATED",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to deactivate workflow template", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
