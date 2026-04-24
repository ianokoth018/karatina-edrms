import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

function isAdmin(session: { user: { permissions: string[]; roles: string[] } }) {
  return (
    session.user.permissions.includes("workflows:manage") ||
    session.user.roles.includes("Admin")
  );
}

/** GET /api/workflows/pools/[id] */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const pool = await db.workflowPool.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, displayName: true, email: true, department: true } },
          },
          orderBy: { joinedAt: "asc" },
        },
        _count: { select: { tasks: true } },
      },
    });

    if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    return NextResponse.json(serialise({ pool }));
  } catch (error) {
    logger.error("Failed to fetch workflow pool", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH /api/workflows/pools/[id] — update name/description */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const { name, description } = body as { name?: string; description?: string };

    const pool = await db.workflowPool.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, displayName: true, email: true } } },
        },
        _count: { select: { tasks: true } },
      },
    });

    return NextResponse.json(serialise({ pool }));
  } catch (error) {
    logger.error("Failed to update workflow pool", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/workflows/pools/[id] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const activeTasks = await db.workflowTask.count({
      where: { poolId: id, status: "PENDING" },
    });
    if (activeTasks > 0) {
      return NextResponse.json(
        { error: `Cannot delete pool with ${activeTasks} active pending task(s)` },
        { status: 409 }
      );
    }

    await db.workflowPool.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete workflow pool", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
