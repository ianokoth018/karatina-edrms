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

/** GET /api/workflows/pools/[id]/members */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const members = await db.workflowPoolMember.findMany({
      where: { poolId: id },
      include: {
        user: { select: { id: true, name: true, displayName: true, email: true, department: true } },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json(serialise({ members }));
  } catch (error) {
    logger.error("Failed to list pool members", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/workflows/pools/[id]/members — add a member */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const { userId } = await req.json() as { userId: string };
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    const user = await db.user.findUnique({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found or inactive" }, { status: 404 });

    const member = await db.workflowPoolMember.create({
      data: { poolId: id, userId },
      include: {
        user: { select: { id: true, name: true, displayName: true, email: true, department: true } },
      },
    });

    return NextResponse.json(serialise({ member }), { status: 201 });
  } catch (error: unknown) {
    // Unique constraint = already a member
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "User is already a member of this pool" }, { status: 409 });
    }
    logger.error("Failed to add pool member", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/workflows/pools/[id]/members?userId=... — remove a member */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId query param required" }, { status: 400 });

    await db.workflowPoolMember.deleteMany({ where: { poolId: id, userId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to remove pool member", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
