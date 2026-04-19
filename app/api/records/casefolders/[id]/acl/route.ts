import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Permission fields used across all ACL operations
// ---------------------------------------------------------------------------
const PERMISSION_FIELDS = [
  "canView",
  "canCreate",
  "canEdit",
  "canDelete",
  "canShare",
  "canDownload",
  "canPrint",
  "canManageACL",
] as const;

type PermissionKey = (typeof PERMISSION_FIELDS)[number];
type Permissions = Record<PermissionKey, boolean>;

const ALL_PERMISSIONS: Permissions = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canShare: true,
  canDownload: true,
  canPrint: true,
  canManageACL: true,
};

const DEFAULT_PERMISSIONS: Permissions = {
  canView: true,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canShare: false,
  canDownload: false,
  canPrint: false,
  canManageACL: false,
};

/**
 * Merge an array of ACL entries into a single effective-permissions object
 * using OR logic: if any matching ACL grants a permission, the user has it.
 */
function mergePermissions(
  acls: Record<string, unknown>[]
): Permissions {
  const merged = { ...DEFAULT_PERMISSIONS, canView: false };
  for (const acl of acls) {
    for (const key of PERMISSION_FIELDS) {
      if ((acl as Record<string, boolean>)[key]) {
        merged[key] = true;
      }
    }
  }
  return merged;
}

/**
 * Pick only the valid permission booleans from a request body object.
 */
function pickPermissions(body: Record<string, unknown>): Partial<Permissions> {
  const result: Partial<Permissions> = {};
  for (const key of PERMISSION_FIELDS) {
    if (typeof body[key] === "boolean") {
      result[key] = body[key] as boolean;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /api/records/casefolders/[id]/acl
// List all ACL entries for a casefolder + current user's effective permissions
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;

    // Verify the casefolder (form template) exists
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { id: true, createdById: true },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Casefolder not found" },
        { status: 404 }
      );
    }

    // Fetch all ACL entries for this casefolder
    const aclEntries = await db.casefolderACL.findMany({
      where: { formTemplateId: id },
      orderBy: { grantedAt: "desc" },
    });

    // Resolve details for each ACL entry
    const enrichedAcls = await Promise.all(
      aclEntries.map(async (acl) => {
        const entry: Record<string, unknown> = { ...acl };

        if (acl.userId) {
          const user = await db.user.findUnique({
            where: { id: acl.userId },
            select: {
              id: true,
              name: true,
              displayName: true,
              email: true,
              department: true,
            },
          });
          entry.user = user;
        }

        if (acl.roleId) {
          const role = await db.role.findUnique({
            where: { id: acl.roleId },
            select: { id: true, name: true },
          });
          entry.role = role;
        }

        if (acl.departmentId) {
          entry.department = acl.departmentId;
        }

        return entry;
      })
    );

    // Calculate effective permissions for the current user
    // Step 1: Get the user's role IDs and department
    const [userRoles, currentUser] = await Promise.all([
      db.userRole.findMany({
        where: { userId },
        include: { role: true },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { department: true },
      }),
    ]);

    const userRoleIds = userRoles.map((ur) => ur.roleId);
    const userDepartment = currentUser?.department ?? null;

    // Step 2: Filter ACL entries that match this user (by userId, roleIds, or department)
    const matchingAcls = aclEntries.filter((acl) => {
      // Skip expired entries
      if (acl.expiresAt && new Date(acl.expiresAt) < new Date()) {
        return false;
      }

      if (acl.userId === userId) return true;
      if (acl.roleId && userRoleIds.includes(acl.roleId)) return true;
      if (acl.departmentId && userDepartment && acl.departmentId === userDepartment) return true;

      return false;
    });

    const isAdmin = session.user.permissions.includes("admin:manage");

    let userPermissions: Permissions;

    if (isAdmin) {
      // Admins always have full access regardless of ACL configuration
      userPermissions = { ...ALL_PERMISSIONS };
    } else if (matchingAcls.length > 0) {
      // User has at least one matching ACL entry — merge with OR logic
      userPermissions = mergePermissions(matchingAcls);
    } else {
      // No matching ACL (whether entries exist or not): deny all access
      userPermissions = {
        canView: false,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canShare: false,
        canDownload: false,
        canPrint: false,
        canManageACL: false,
      };
    }

    return NextResponse.json({
      acls: enrichedAcls,
      userPermissions,
    });
  } catch (error) {
    logger.error("Failed to list casefolder ACLs", error, {
      route: "/api/records/casefolders/[id]/acl",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/casefolders/[id]/acl
// Grant access (or update if duplicate target exists)
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const { type, targetId, expiresAt, notes } = body as {
      type?: string;
      targetId?: string;
      expiresAt?: string;
      notes?: string;
    };

    // Validate required fields
    if (!type || !targetId) {
      return NextResponse.json(
        { error: "type and targetId are required" },
        { status: 400 }
      );
    }

    if (!["user", "role", "department"].includes(type)) {
      return NextResponse.json(
        { error: "type must be one of: user, role, department" },
        { status: 400 }
      );
    }

    // Verify the casefolder exists
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Casefolder not found" },
        { status: 404 }
      );
    }

    // Build the target filter for duplicate detection
    const targetFilter: Record<string, string | null> = {
      userId: null,
      roleId: null,
      departmentId: null,
    };

    if (type === "user") {
      // Verify user exists
      const targetUser = await db.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!targetUser) {
        return NextResponse.json(
          { error: "Target user not found" },
          { status: 404 }
        );
      }
      targetFilter.userId = targetId;
    } else if (type === "role") {
      // Verify role exists
      const targetRole = await db.role.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!targetRole) {
        return NextResponse.json(
          { error: "Target role not found" },
          { status: 404 }
        );
      }
      targetFilter.roleId = targetId;
    } else {
      // department: targetId is the department name string
      targetFilter.departmentId = targetId;
    }

    const permissions = pickPermissions(body);

    // Check for existing ACL (upsert behaviour)
    const existing = await db.casefolderACL.findFirst({
      where: {
        formTemplateId: id,
        ...(type === "user" && { userId: targetId }),
        ...(type === "role" && { roleId: targetId }),
        ...(type === "department" && { departmentId: targetId }),
      },
    });

    let acl;
    let action: string;

    if (existing) {
      // Update existing ACL entry
      acl = await db.casefolderACL.update({
        where: { id: existing.id },
        data: {
          ...permissions,
          grantedById: session.user.id,
          grantedAt: new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          notes: notes ?? existing.notes,
        },
      });
      action = "casefolder_acl.updated";
    } else {
      // Create new ACL entry
      acl = await db.casefolderACL.create({
        data: {
          formTemplateId: id,
          userId: targetFilter.userId,
          roleId: targetFilter.roleId,
          departmentId: targetFilter.departmentId,
          ...permissions,
          grantedById: session.user.id,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          notes: notes ?? null,
        },
      });
      action = "casefolder_acl.granted";
    }

    await writeAudit({
      userId: session.user.id,
      action,
      resourceType: "CasefolderACL",
      resourceId: acl.id,
      metadata: {
        formTemplateId: id,
        casefolderName: template.name,
        type,
        targetId,
        permissions,
        expiresAt: expiresAt ?? null,
        notes: notes ?? null,
      },
    });

    logger.info("Casefolder ACL granted/updated", {
      userId: session.user.id,
      action,
      route: `/api/records/casefolders/${id}/acl`,
      method: "POST",
    });

    return NextResponse.json(acl, { status: existing ? 200 : 201 });
  } catch (error) {
    logger.error("Failed to grant casefolder ACL", error, {
      route: "/api/records/casefolders/[id]/acl",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/casefolders/[id]/acl
// Update an existing ACL entry
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const { aclId } = body as { aclId?: string };

    if (!aclId) {
      return NextResponse.json(
        { error: "aclId is required" },
        { status: 400 }
      );
    }

    // Verify the ACL entry exists and belongs to this casefolder
    const existing = await db.casefolderACL.findUnique({
      where: { id: aclId },
    });

    if (!existing || existing.formTemplateId !== id) {
      return NextResponse.json(
        { error: "ACL entry not found" },
        { status: 404 }
      );
    }

    // Fetch casefolder name for audit
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { name: true },
    });

    const permissions = pickPermissions(body);

    // Build update data: permissions + optional fields
    const updateData: Record<string, unknown> = { ...permissions };
    if (typeof body.expiresAt === "string") {
      updateData.expiresAt = new Date(body.expiresAt as string);
    } else if (body.expiresAt === null) {
      updateData.expiresAt = null;
    }
    if (typeof body.notes === "string") {
      updateData.notes = body.notes;
    }

    const acl = await db.casefolderACL.update({
      where: { id: aclId },
      data: updateData,
    });

    await writeAudit({
      userId: session.user.id,
      action: "casefolder_acl.updated",
      resourceType: "CasefolderACL",
      resourceId: acl.id,
      metadata: {
        formTemplateId: id,
        casefolderName: template?.name ?? null,
        changes: updateData,
      },
    });

    logger.info("Casefolder ACL updated", {
      userId: session.user.id,
      action: "casefolder_acl.updated",
      route: `/api/records/casefolders/${id}/acl`,
      method: "PATCH",
    });

    return NextResponse.json(acl);
  } catch (error) {
    logger.error("Failed to update casefolder ACL", error, {
      route: "/api/records/casefolders/[id]/acl",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/records/casefolders/[id]/acl
// Revoke access by deleting an ACL entry
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const { aclId } = body as { aclId?: string };

    if (!aclId) {
      return NextResponse.json(
        { error: "aclId is required" },
        { status: 400 }
      );
    }

    // Verify the ACL entry exists and belongs to this casefolder
    const existing = await db.casefolderACL.findUnique({
      where: { id: aclId },
    });

    if (!existing || existing.formTemplateId !== id) {
      return NextResponse.json(
        { error: "ACL entry not found" },
        { status: 404 }
      );
    }

    // Fetch casefolder name for audit
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { name: true },
    });

    await db.casefolderACL.delete({
      where: { id: aclId },
    });

    await writeAudit({
      userId: session.user.id,
      action: "casefolder_acl.revoked",
      resourceType: "CasefolderACL",
      resourceId: aclId,
      metadata: {
        formTemplateId: id,
        casefolderName: template?.name ?? null,
        revokedEntry: {
          userId: existing.userId,
          roleId: existing.roleId,
          departmentId: existing.departmentId,
        },
      },
    });

    logger.info("Casefolder ACL revoked", {
      userId: session.user.id,
      action: "casefolder_acl.revoked",
      route: `/api/records/casefolders/${id}/acl`,
      method: "DELETE",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to revoke casefolder ACL", error, {
      route: "/api/records/casefolders/[id]/acl",
      method: "DELETE",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
