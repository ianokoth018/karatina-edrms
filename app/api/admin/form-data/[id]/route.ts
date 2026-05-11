import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/form-data/[id] */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const schema = await db.formDataSchema.findUnique({
      where: { id },
      include: { _count: { select: { records: true } } },
    });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ schema });
  } catch (error) {
    logger.error("Failed to get form data schema", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** PUT /api/admin/form-data/[id] — update schema definition */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json() as {
      name?: string;
      description?: string;
      fields?: object[];
      isActive?: boolean;
    };

    const schema = await db.formDataSchema.update({
      where: { id },
      data: {
        name: body.name?.trim() || undefined,
        description: body.description ?? undefined,
        fields: body.fields !== undefined ? body.fields as object : undefined,
        isActive: body.isActive,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.form_data_schema_updated",
      resourceType: "FormDataSchema",
      resourceId: id,
      metadata: { name: schema.name },
    });

    return NextResponse.json({ schema });
  } catch (error) {
    logger.error("Failed to update form data schema", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/form-data/[id] */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const schema = await db.formDataSchema.findUnique({ where: { id } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.formDataSchema.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "admin.form_data_schema_deleted",
      resourceType: "FormDataSchema",
      resourceId: id,
      metadata: { name: schema.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete form data schema", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
