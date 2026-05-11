import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string; recordId: string }> };

/** PUT /api/admin/form-data/[id]/records/[recordId] */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, recordId } = await params;
    const body = await req.json() as { data?: Record<string, unknown> };

    const record = await db.formDataEntry.update({
      where: { id: recordId, schemaId: id },
      data: { data: (body.data ?? {}) as object },
    });

    return NextResponse.json({ record });
  } catch (error) {
    logger.error("Failed to update form data record", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/form-data/[id]/records/[recordId] */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, recordId } = await params;
    await db.formDataEntry.delete({ where: { id: recordId, schemaId: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete form data record", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
