import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/forms/[id] -- Get a single form template
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const template = await db.formTemplate.findUnique({
      where: { id },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Form template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: template.id,
      name: template.name,
      description: template.description,
      fields: template.fields,
      workflowTemplateId: template.workflowTemplateId,
      isActive: template.isActive,
      version: template.version,
      createdById: template.createdById,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      submissionCount: template._count.submissions,
    });
  } catch (error) {
    logger.error("Failed to fetch form template", error, {
      route: "/api/forms/[id]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/forms/[id] -- Update a form template
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.formTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Form template not found" },
        { status: 404 },
      );
    }

    const body = await req.json();
    const { name, description, fields, isActive, workflowTemplateId } =
      body as {
        name?: string;
        description?: string;
        fields?: unknown[];
        isActive?: boolean;
        workflowTemplateId?: string;
      };

    // If renaming, check for duplicate name
    if (name && name.trim() !== existing.name) {
      const duplicate = await db.formTemplate.findUnique({
        where: { name: name.trim() },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A form template with this name already exists" },
          { status: 409 },
        );
      }
    }

    const data: Record<string, unknown> = {};

    if (name !== undefined) {
      data.name = name.trim();
    }
    if (description !== undefined) {
      data.description = description?.trim() || null;
    }
    if (fields !== undefined) {
      if (!Array.isArray(fields) || fields.length === 0) {
        return NextResponse.json(
          { error: "Fields must be a non-empty array" },
          { status: 400 },
        );
      }
      data.fields = fields as never;
      // Increment version when fields change
      data.version = existing.version + 1;
    }
    if (isActive !== undefined) {
      data.isActive = isActive;
    }
    if (workflowTemplateId !== undefined) {
      data.workflowTemplateId = workflowTemplateId?.trim() || null;
    }

    const updated = await db.formTemplate.update({
      where: { id },
      data,
    });

    await writeAudit({
      userId: session.user.id,
      action: "form_template.update",
      resourceType: "FormTemplate",
      resourceId: updated.id,
      metadata: {
        name: updated.name,
        changedFields: Object.keys(data),
        newVersion: updated.version,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update form template", error, {
      route: "/api/forms/[id]",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/forms/[id] -- Soft-delete a form template (set isActive=false)
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.formTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Form template not found" },
        { status: 404 },
      );
    }

    if (!existing.isActive) {
      return NextResponse.json(
        { error: "Form template is already inactive" },
        { status: 400 },
      );
    }

    await db.formTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAudit({
      userId: session.user.id,
      action: "form_template.delete",
      resourceType: "FormTemplate",
      resourceId: id,
      metadata: {
        name: existing.name,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete form template", error, {
      route: "/api/forms/[id]",
      method: "DELETE",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
