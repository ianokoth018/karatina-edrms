import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/** GET /api/workflows/pools — list pools with member counts */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const pools = await db.workflowPool.findMany({
      include: {
        members: {
          include: { user: { select: { id: true, name: true, displayName: true, email: true } } },
        },
        _count: { select: { tasks: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(serialise({ pools }));
  } catch (error) {
    logger.error("Failed to list workflow pools", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/workflows/pools — create pool and optionally add initial members */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!hasPermission) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { name, description, memberIds = [] } = body as {
      name: string;
      description?: string;
      memberIds?: string[];
    };

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const pool = await db.workflowPool.create({
      data: {
        name,
        description,
        createdById: session.user.id,
        members: {
          create: memberIds.map((userId: string) => ({ userId })),
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, displayName: true } } },
        },
      },
    });

    return NextResponse.json(serialise({ pool }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create workflow pool", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
