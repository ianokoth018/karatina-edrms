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
        slug: true,
        instanceName: true,
        sidebarIcon: true,
        sidebarOrder: true,
        customQueries: true,
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
    const { name, description, definition, isActive, slug, instanceName, sidebarIcon, sidebarOrder, customQueries } = body as {
      name?: string;
      description?: string;
      definition?: Record<string, unknown>;
      isActive?: boolean;
      slug?: string | null;
      instanceName?: string | null;
      sidebarIcon?: string | null;
      sidebarOrder?: number;
      customQueries?: unknown[];
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

    // If slug is changing, check for duplicate
    if (slug !== undefined && slug !== null && slug !== (existing as Record<string, unknown>).slug) {
      const duplicateSlug = await db.workflowTemplate.findUnique({ where: { slug } });
      if (duplicateSlug && duplicateSlug.id !== id) {
        return NextResponse.json(
          { error: "A template with this slug already exists" },
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
    if (slug !== undefined) updateData.slug = slug;
    if (instanceName !== undefined) updateData.instanceName = instanceName;
    if (sidebarIcon !== undefined) updateData.sidebarIcon = sidebarIcon;
    if (sidebarOrder !== undefined) updateData.sidebarOrder = sidebarOrder;
    if (customQueries !== undefined) updateData.customQueries = customQueries;

    // Warn caller if there are active instances on the current version
    const activeInstanceCount = definition
      ? await db.workflowInstance.count({
          where: { templateId: id, status: { in: ["PENDING", "IN_PROGRESS"] } },
        })
      : 0;

    // Snapshot the template every time it transitions from unpublished
    // to published. This gives admins a permanent record of every
    // published revision for diffing and rollback. We do this *before*
    // the update so the snapshot reflects exactly what was approved.
    const isPublishing = isActive === true && existing.isActive === false;
    if (isPublishing) {
      const snapshotDefinition =
        definition !== undefined ? definition : (existing.definition as object);
      const snapshotName = name ?? existing.name;
      const snapshotDescription =
        description !== undefined ? description : existing.description;
      const snapshotVersion =
        definition !== undefined ? existing.version + 1 : existing.version;
      await db.workflowTemplateVersion.create({
        data: {
          templateId: id,
          version: snapshotVersion,
          name: snapshotName,
          description: snapshotDescription,
          definition: snapshotDefinition as object,
          publishedById: session.user.id,
        },
      });
    }

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
        slug: true,
        instanceName: true,
        sidebarIcon: true,
        sidebarOrder: true,
        customQueries: true,
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

    return NextResponse.json(serialise({
      template,
      warnings: activeInstanceCount > 0
        ? [`${activeInstanceCount} active instance(s) still running on the previous version. Use POST /migrate to upgrade them.`]
        : [],
    }));
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
 * Hard-delete a template. Blocked if any instances exist (active or historical).
 * Use PUT { isActive: false } to deactivate without deleting.
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

    const existing = await db.workflowTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const instanceCount = await db.workflowInstance.count({ where: { templateId: id } });
    if (instanceCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete — this template has ${instanceCount} instance(s). Deactivate it instead to preserve the history.` },
        { status: 409 }
      );
    }

    await db.workflowTemplate.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_DELETED",
      resourceType: "workflow_template",
      resourceId: id,
      metadata: { name: existing.name },
    });

    logger.info("Workflow template deleted", { userId: session.user.id, templateId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete workflow template", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
