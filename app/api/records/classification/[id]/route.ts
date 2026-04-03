import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/classification/[id] — single node with full detail
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

    const node = await db.classificationNode.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, code: true, title: true, level: true } },
        children: {
          where: { isActive: true },
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            title: true,
            level: true,
            isActive: true,
            _count: { select: { children: true, documents: true } },
          },
        },
        retentionSchedules: true,
        _count: { select: { documents: true } },
      },
    });

    if (!node) {
      return NextResponse.json(
        { error: "Classification node not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(node);
  } catch (error) {
    logger.error("Failed to get classification node", error, {
      route: "/api/records/classification/[id]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/classification/[id] — update node metadata
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
    const body = await req.json();
    const { title, description, code, isActive } = body as {
      title?: string;
      description?: string;
      code?: string;
      isActive?: boolean;
    };

    // Reject attempts to change level or parentId
    if ("level" in body) {
      return NextResponse.json(
        { error: "Cannot change the level of an existing node" },
        { status: 400 }
      );
    }

    if ("parentId" in body) {
      return NextResponse.json(
        { error: "Cannot change the parent of an existing node" },
        { status: 400 }
      );
    }

    // Verify the node exists
    const existing = await db.classificationNode.findUnique({
      where: { id },
      select: { id: true, code: true, title: true, isActive: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Classification node not found" },
        { status: 404 }
      );
    }

    // If changing code, verify uniqueness
    if (code !== undefined && code.trim() !== existing.code) {
      const duplicate = await db.classificationNode.findUnique({
        where: { code: code.trim() },
        select: { id: true },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: `Classification code "${code.trim()}" is already in use` },
          { status: 409 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim() || null;
    if (code !== undefined) updateData.code = code.trim();
    if (isActive !== undefined) updateData.isActive = isActive;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updated = await db.classificationNode.update({
      where: { id },
      data: updateData,
      include: {
        parent: { select: { id: true, code: true, title: true, level: true } },
        children: {
          where: { isActive: true },
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            title: true,
            level: true,
            isActive: true,
          },
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "classification.updated",
      resourceType: "ClassificationNode",
      resourceId: id,
      metadata: {
        changes: Object.keys(updateData),
        previousCode: existing.code,
        previousTitle: existing.title,
      },
    });

    logger.info("Classification node updated", {
      userId: session.user.id,
      action: "classification.updated",
      route: `/api/records/classification/${id}`,
      method: "PATCH",
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update classification node", error, {
      route: "/api/records/classification/[id]",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/records/classification/[id] — soft delete (set isActive=false)
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.classificationNode.findUnique({
      where: { id },
      select: { id: true, code: true, title: true, isActive: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Classification node not found" },
        { status: 404 }
      );
    }

    if (!existing.isActive) {
      return NextResponse.json(
        { error: "Node is already inactive" },
        { status: 400 }
      );
    }

    // Check for active children
    const activeChildCount = await db.classificationNode.count({
      where: { parentId: id, isActive: true },
    });

    if (activeChildCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot deactivate this node because it has ${activeChildCount} active child node(s). Deactivate or reassign them first.`,
        },
        { status: 400 }
      );
    }

    // Check for assigned documents
    const assignedDocCount = await db.document.count({
      where: { classificationNodeId: id, status: { not: "DISPOSED" } },
    });

    if (assignedDocCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot deactivate this node because ${assignedDocCount} document(s) are assigned to it. Reassign or dispose them first.`,
        },
        { status: 400 }
      );
    }

    // Soft delete
    await db.classificationNode.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAudit({
      userId: session.user.id,
      action: "classification.deactivated",
      resourceType: "ClassificationNode",
      resourceId: id,
      metadata: {
        code: existing.code,
        title: existing.title,
      },
    });

    logger.info("Classification node deactivated", {
      userId: session.user.id,
      action: "classification.deactivated",
      route: `/api/records/classification/${id}`,
      method: "DELETE",
    });

    return NextResponse.json({
      message: "Classification node deactivated successfully",
    });
  } catch (error) {
    logger.error("Failed to deactivate classification node", error, {
      route: "/api/records/classification/[id]",
      method: "DELETE",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
