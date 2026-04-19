import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/documents/[id]/access — list all access control entries
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

    // Verify the document exists
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const accessEntries = await db.documentAccessControl.findMany({
      where: { documentId: id },
    });

    // Collect unique user and role IDs for joining details
    const userIds = accessEntries
      .map((e) => e.userId)
      .filter((uid): uid is string => uid !== null);

    const roleIds = accessEntries
      .map((e) => e.roleId)
      .filter((rid): rid is string => rid !== null);

    const [users, roles] = await Promise.all([
      userIds.length > 0
        ? db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, displayName: true, email: true },
          })
        : [],
      roleIds.length > 0
        ? db.role.findMany({
            where: { id: { in: roleIds } },
            select: { id: true, name: true, description: true },
          })
        : [],
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const roleMap = new Map(roles.map((r) => [r.id, r]));

    const enriched = accessEntries.map((entry) => ({
      ...entry,
      user: entry.userId ? userMap.get(entry.userId) ?? null : null,
      role: entry.roleId ? roleMap.get(entry.roleId) ?? null : null,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    logger.error("Failed to list access controls", error, {
      route: "/api/documents/[id]/access",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/access — grant access to a user or role
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
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;
    const body = await req.json();
    const { userId, roleId, canRead, canWrite, canDelete, canShare } = body;

    // Must provide either userId or roleId, but not both empty
    if (!userId && !roleId) {
      return NextResponse.json(
        { error: "Either userId or roleId is required" },
        { status: 400 }
      );
    }

    // Verify the document exists
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Prevent duplicate entries for the same user/role on the same document
    const existing = await db.documentAccessControl.findFirst({
      where: {
        documentId: id,
        ...(userId ? { userId } : { roleId }),
      },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: userId
            ? "Access control entry already exists for this user on this document"
            : "Access control entry already exists for this role on this document",
        },
        { status: 409 }
      );
    }

    const accessEntry = await db.documentAccessControl.create({
      data: {
        documentId: id,
        userId: userId ?? null,
        roleId: roleId ?? null,
        canRead: canRead ?? true,
        canWrite: canWrite ?? false,
        canDelete: canDelete ?? false,
        canShare: canShare ?? false,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.access_granted",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        accessId: accessEntry.id,
        grantedUserId: userId ?? null,
        grantedRoleId: roleId ?? null,
        canRead: accessEntry.canRead,
        canWrite: accessEntry.canWrite,
        canDelete: accessEntry.canDelete,
        canShare: accessEntry.canShare,
        referenceNumber: document.referenceNumber,
      },
    });

    logger.info("Document access granted", {
      userId: session.user.id,
      action: "document.access_granted",
      route: `/api/documents/${id}/access`,
      method: "POST",
    });

    return NextResponse.json(accessEntry, { status: 201 });
  } catch (error) {
    logger.error("Failed to grant document access", error, {
      route: "/api/documents/[id]/access",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/documents/[id]/access — revoke an access control entry
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
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;
    const body = await req.json();
    const { accessId } = body;

    if (!accessId) {
      return NextResponse.json(
        { error: "accessId is required" },
        { status: 400 }
      );
    }

    // Verify the document exists
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Verify the access control entry exists and belongs to this document
    const accessEntry = await db.documentAccessControl.findUnique({
      where: { id: accessId },
    });

    if (!accessEntry || accessEntry.documentId !== id) {
      return NextResponse.json(
        { error: "Access control entry not found for this document" },
        { status: 404 }
      );
    }

    await db.documentAccessControl.delete({
      where: { id: accessId },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.access_revoked",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        accessId,
        revokedUserId: accessEntry.userId,
        revokedRoleId: accessEntry.roleId,
        referenceNumber: document.referenceNumber,
      },
    });

    logger.info("Document access revoked", {
      userId: session.user.id,
      action: "document.access_revoked",
      route: `/api/documents/${id}/access`,
      method: "DELETE",
    });

    return NextResponse.json({ message: "Access revoked successfully" });
  } catch (error) {
    logger.error("Failed to revoke document access", error, {
      route: "/api/documents/[id]/access",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
