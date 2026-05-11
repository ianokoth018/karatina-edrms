import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const matrices = await db.escalationMatrix.findMany({
      orderBy: { name: "asc" },
    });

    // Enrich with user/role/pool names
    const enriched = await Promise.all(
      matrices.map(async (m) => {
        const user = m.userId ? await db.user.findUnique({ where: { id: m.userId }, select: { name: true, displayName: true } }) : null;
        const role = m.roleId ? await db.role.findUnique({ where: { id: m.roleId }, select: { name: true } }) : null;
        const pool = m.poolId ? await db.workflowPool.findUnique({ where: { id: m.poolId }, select: { name: true } }) : null;
        return { ...m, _user: user, _role: role, _pool: pool };
      })
    );

    return NextResponse.json({ matrices: enriched });
  } catch (error) {
    logger.error("Failed to list escalation matrices", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const matrix = await db.escalationMatrix.create({
      data: {
        name,
        description: body.description ?? null,
        userId: body.userId || null,
        roleId: body.roleId || null,
        department: body.department || null,
        poolId: body.poolId || null,
        levels: (body.levels ?? []) as object,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.escalation_matrix_created",
      resourceType: "EscalationMatrix",
      resourceId: matrix.id,
      metadata: { name },
    });

    return NextResponse.json({ matrix }, { status: 201 });
  } catch (error: unknown) {
    const msg = (error as { code?: string })?.code === "P2002"
      ? "An escalation matrix with this name already exists"
      : "Internal error";
    logger.error("Failed to create escalation matrix", error);
    return NextResponse.json({ error: msg }, { status: msg.includes("already") ? 409 : 500 });
  }
}
