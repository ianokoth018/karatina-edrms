import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * PATCH /api/admin/roles/[id]
 * Update role name/description and replace permissions.
 * Body: { name?, description?, permissions?: [{ resource, action }] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, description, permissions } = body as {
      name?: string;
      description?: string;
      permissions?: { resource: string; action: string }[];
    };

    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (existing.name === "ADMIN") {
      return NextResponse.json(
        { error: "The ADMIN role cannot be modified" },
        { status: 403 }
      );
    }

    // Check name uniqueness if changing
    if (name && name !== existing.name) {
      const dup = await db.role.findUnique({ where: { name } });
      if (dup) {
        return NextResponse.json(
          { error: "A role with this name already exists" },
          { status: 409 }
        );
      }
    }

    // Update role fields
    await db.role.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      },
    });

    // Replace permissions if provided
    if (permissions !== undefined) {
      await db.permission.deleteMany({ where: { roleId: id } });
      if (permissions.length > 0) {
        await db.permission.createMany({
          data: permissions.map((p) => ({
            roleId: id,
            resource: p.resource,
            action: p.action,
          })),
        });
      }
    }

    const role = await db.role.findUnique({
      where: { id },
      include: {
        permissions: true,
        _count: { select: { users: true } },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "ROLE_UPDATED",
      resourceType: "role",
      resourceId: id,
      metadata: { changes: body },
    });

    return NextResponse.json({ role });
  } catch (error) {
    logger.error("Failed to update role", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/roles/[id]
 * Delete a role -- only if no users are assigned to it.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (existing.name === "ADMIN") {
      return NextResponse.json(
        { error: "The ADMIN role cannot be deleted" },
        { status: 403 }
      );
    }

    if (existing._count.users > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete role: ${existing._count.users} user(s) are still assigned to it`,
        },
        { status: 400 }
      );
    }

    // Cascade deletes permissions via schema onDelete: Cascade
    await db.role.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "ROLE_DELETED",
      resourceType: "role",
      resourceId: id,
      metadata: { roleName: existing.name },
    });

    return NextResponse.json({ message: "Role deleted" });
  } catch (error) {
    logger.error("Failed to delete role", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
