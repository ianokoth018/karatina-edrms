import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/admin/users/[id]
 * Retrieve a single user with roles and permissions.
 */
export async function GET(
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

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        employeeId: true,
        department: true,
        jobTitle: true,
        designation: true,
        phone: true,
        isActive: true,
        mustChangePassword: true,
        passwordResetExpiresAt: true,
        mfaEnabled: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        passwordChangedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Flatten permissions for convenience
    const permissions = [
      ...new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((p) => `${p.resource}:${p.action}`)
        )
      ),
    ];

    return NextResponse.json(serialise({ user, permissions }));
  } catch (error) {
    logger.error("Failed to get user", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users/[id]
 * Update a user: name, email, department, isActive, roles.
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
    const {
      name,
      email,
      department,
      jobTitle,
      designation,
      phone,
      employeeId,
      isActive,
      roleIds,
      unlock,
    } = body as {
      name?: string;
      email?: string;
      department?: string | null;
      jobTitle?: string | null;
      designation?: string | null;
      phone?: string | null;
      employeeId?: string | null;
      isActive?: boolean;
      roleIds?: string[];
      /** When true, clear lockout + reset failed-attempt counter. */
      unlock?: boolean;
    };

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If email is being changed, check for duplicates
    if (email && email !== existing.email) {
      const dup = await db.user.findUnique({ where: { email } });
      if (dup) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 409 }
        );
      }
    }

    // Update user fields
    const user = await db.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name, displayName: name }),
        ...(email !== undefined && { email }),
        ...(department !== undefined && { department }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(designation !== undefined && { designation }),
        ...(phone !== undefined && { phone }),
        ...(employeeId !== undefined && { employeeId }),
        ...(isActive !== undefined && { isActive }),
        ...(unlock && { failedLoginAttempts: 0, lockedUntil: null }),
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        employeeId: true,
        department: true,
        jobTitle: true,
        designation: true,
        phone: true,
        isActive: true,
        mustChangePassword: true,
        passwordResetExpiresAt: true,
        mfaEnabled: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        createdAt: true,
        roles: {
          include: {
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    // If roleIds were provided, replace all role assignments
    if (roleIds !== undefined) {
      await db.userRole.deleteMany({ where: { userId: id } });
      if (roleIds.length > 0) {
        await db.userRole.createMany({
          data: roleIds.map((roleId: string) => ({ userId: id, roleId })),
        });
      }
      // Re-fetch with updated roles
      const updated = await db.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          displayName: true,
          email: true,
          employeeId: true,
          department: true,
          jobTitle: true,
          designation: true,
          phone: true,
          isActive: true,
          mustChangePassword: true,
          passwordResetExpiresAt: true,
          lastLoginAt: true,
          createdAt: true,
          roles: {
            include: {
              role: { select: { id: true, name: true } },
            },
          },
        },
      });

      await writeAudit({
        userId: session.user.id,
        action: "USER_UPDATED",
        resourceType: "user",
        resourceId: id,
        metadata: { changes: body },
      });

      return NextResponse.json(serialise({ user: updated }));
    }

    await writeAudit({
      userId: session.user.id,
      action: "USER_UPDATED",
      resourceType: "user",
      resourceId: id,
      metadata: { changes: body },
    });

    return NextResponse.json(serialise({ user }));
  } catch (error) {
    logger.error("Failed to update user", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[id]
 * Soft-delete: set isActive to false.
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

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent self-deactivation
    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Cannot deactivate your own account" },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_DEACTIVATED",
      resourceType: "user",
      resourceId: id,
    });

    return NextResponse.json({ message: "User deactivated" });
  } catch (error) {
    logger.error("Failed to deactivate user", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
