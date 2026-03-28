import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/roles
 * List all roles with permission counts.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const roles = await db.role.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        permissions: true,
        _count: {
          select: { users: true },
        },
      },
    });

    return NextResponse.json({ roles });
  } catch (error) {
    logger.error("Failed to list roles", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/roles
 * Create a new role with permissions.
 * Body: { name, description?, permissions: [{ resource, action }] }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, description, permissions } = body as {
      name: string;
      description?: string;
      permissions?: { resource: string; action: string }[];
    };

    if (!name) {
      return NextResponse.json(
        { error: "Role name is required" },
        { status: 400 }
      );
    }

    const existing = await db.role.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: "A role with this name already exists" },
        { status: 409 }
      );
    }

    const role = await db.role.create({
      data: {
        name,
        description: description ?? null,
        permissions: permissions?.length
          ? {
              create: permissions.map((p) => ({
                resource: p.resource,
                action: p.action,
              })),
            }
          : undefined,
      },
      include: {
        permissions: true,
        _count: { select: { users: true } },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "ROLE_CREATED",
      resourceType: "role",
      resourceId: role.id,
      metadata: { name, permissionCount: permissions?.length ?? 0 },
    });

    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create role", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
