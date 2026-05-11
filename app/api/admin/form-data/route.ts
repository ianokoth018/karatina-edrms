import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** GET /api/admin/form-data — list all schemas */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const schemas = await db.formDataSchema.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { records: true } } },
    });
    return NextResponse.json({ schemas });
  } catch (error) {
    logger.error("Failed to list form data schemas", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SchemaBody {
  name?: string;
  slug?: string;
  description?: string;
  fields?: FieldDef[];
}

interface FieldDef {
  id: string;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];  // for select fields
}

/** POST /api/admin/form-data — create a new schema */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as SchemaBody;
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const slug = body.slug?.trim() || toSlug(name);
    if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
      return NextResponse.json({ error: "Slug must be lowercase letters, numbers, underscores" }, { status: 400 });
    }

    const schema = await db.formDataSchema.create({
      data: {
        name,
        slug,
        description: (body.description ?? "").trim() || null,
        fields: (body.fields ?? []) as object,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.form_data_schema_created",
      resourceType: "FormDataSchema",
      resourceId: schema.id,
      metadata: { name, slug },
    });

    return NextResponse.json({ schema }, { status: 201 });
  } catch (error: unknown) {
    const msg = (error as { code?: string })?.code === "P2002"
      ? "A dataset with this name or slug already exists"
      : "Internal error";
    logger.error("Failed to create form data schema", error);
    return NextResponse.json({ error: msg }, { status: msg.includes("already") ? 409 : 500 });
  }
}
