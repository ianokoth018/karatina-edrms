import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const matrix = await db.escalationMatrix.findUnique({ where: { id } });
    if (!matrix) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ matrix });
  } catch (error) {
    logger.error("Failed to get escalation matrix", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const body = await req.json();

    const matrix = await db.escalationMatrix.update({
      where: { id },
      data: {
        name: body.name?.trim() || undefined,
        description: body.description ?? undefined,
        userId: body.userId ?? null,
        roleId: body.roleId ?? null,
        department: body.department ?? null,
        poolId: body.poolId ?? null,
        levels: body.levels !== undefined ? body.levels as object : undefined,
        isActive: body.isActive,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.escalation_matrix_updated",
      resourceType: "EscalationMatrix",
      resourceId: id,
      metadata: { name: matrix.name },
    });

    return NextResponse.json({ matrix });
  } catch (error) {
    logger.error("Failed to update escalation matrix", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    await db.escalationMatrix.delete({ where: { id } });
    await writeAudit({
      userId: session.user.id,
      action: "admin.escalation_matrix_deleted",
      resourceType: "EscalationMatrix",
      resourceId: id,
      metadata: {},
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete escalation matrix", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
