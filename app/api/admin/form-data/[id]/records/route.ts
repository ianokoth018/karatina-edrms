import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/form-data/[id]/records */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const url = req.nextUrl;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const search = url.searchParams.get("search") ?? "";

    const schema = await db.formDataSchema.findUnique({ where: { id } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const records = await db.formDataEntry.findMany({
      where: { schemaId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Client-side search filter (search across all string values)
    const filtered = search
      ? records.filter((r) =>
          JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase())
        )
      : records;

    const total = await db.formDataEntry.count({ where: { schemaId: id } });

    return NextResponse.json({ records: filtered, total, page, limit });
  } catch (error) {
    logger.error("Failed to list form data records", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** POST /api/admin/form-data/[id]/records — create a record */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const schema = await db.formDataSchema.findUnique({ where: { id } });
    if (!schema) return NextResponse.json({ error: "Schema not found" }, { status: 404 });

    const body = await req.json() as { data?: Record<string, unknown> };
    const data = body.data ?? {};

    const record = await db.formDataEntry.create({
      data: { schemaId: id, data: data as object, createdById: session.user.id },
    });

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create form data record", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/form-data/[id]/records — bulk delete */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json() as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }

    await db.formDataEntry.deleteMany({
      where: { schemaId: id, id: { in: body.ids } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to bulk delete form data records", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
