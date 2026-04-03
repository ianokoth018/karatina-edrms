import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/forms -- List all form templates
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const activeOnly = searchParams.get("active") === "true";

    const where: Record<string, unknown> = {};
    if (activeOnly) {
      where.isActive = true;
    }

    const templates = await db.formTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { submissions: true },
        },
      },
    });

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        fields: t.fields,
        workflowTemplateId: t.workflowTemplateId,
        isActive: t.isActive,
        version: t.version,
        createdById: t.createdById,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        submissionCount: t._count.submissions,
      })),
    });
  } catch (error) {
    logger.error("Failed to list form templates", error, {
      route: "/api/forms",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/forms -- Create a new form template
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, description, fields, workflowTemplateId } = body as {
      name?: string;
      description?: string;
      fields?: unknown[];
      workflowTemplateId?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 },
      );
    }

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return NextResponse.json(
        { error: "At least one field definition is required" },
        { status: 400 },
      );
    }

    // Check for duplicate name
    const existing = await db.formTemplate.findUnique({
      where: { name: name.trim() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A form template with this name already exists" },
        { status: 409 },
      );
    }

    const template = await db.formTemplate.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        fields: fields as never,
        workflowTemplateId: workflowTemplateId?.trim() || null,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "form_template.create",
      resourceType: "FormTemplate",
      resourceId: template.id,
      metadata: {
        name: template.name,
        fieldCount: fields.length,
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    logger.error("Failed to create form template", error, {
      route: "/api/forms",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
