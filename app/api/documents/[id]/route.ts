import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

/**
 * Custom JSON serialiser that converts BigInt values to strings.
 */
function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
  // Dates must be preserved as ISO strings — recursing into them treats them
  // as empty objects (they have no own enumerable keys) which breaks every
  // downstream `new Date(x)` with `Invalid Date`.
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(serialiseBigInt);
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = serialiseBigInt(v);
    }
    return out;
  }
  return data;
}

// ---------------------------------------------------------------------------
// GET /api/documents/[id] — single document with full detail
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const document = await db.document.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, displayName: true, email: true } },
        classificationNode: { select: { id: true, code: true, title: true, level: true } },
        files: {
          orderBy: { uploadedAt: "desc" },
        },
        versions: {
          orderBy: { versionNum: "desc" },
        },
        tags: true,
        accessControls: true,
        workflowInstances: {
          select: { id: true, referenceNumber: true, status: true, subject: true },
          orderBy: { startedAt: "desc" },
          take: 5,
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // If the document is linked to a casefolder (FormTemplate), load the
    // template's fields so the client can render the casefolder-defined
    // metadata fields alongside the document detail.
    let casefolder:
      | { id: string; name: string; fields: unknown }
      | null = null;
    const docMetadata = (document.metadata ?? null) as Record<string, unknown> | null;
    const formTemplateId =
      docMetadata && typeof docMetadata.formTemplateId === "string"
        ? (docMetadata.formTemplateId as string)
        : null;
    if (formTemplateId) {
      const template = await db.formTemplate.findUnique({
        where: { id: formTemplateId },
        select: { id: true, name: true, fields: true },
      });
      if (template) {
        casefolder = {
          id: template.id,
          name: template.name,
          fields: template.fields,
        };
      }
    }

    // Fetch audit logs for this document
    const auditLogs = await db.auditLog.findMany({
      where: {
        resourceType: "Document",
        resourceId: id,
      },
      include: {
        user: { select: { id: true, name: true, displayName: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });

    // Resolve effective permissions (casefolder ACL + DAC + creator/admin).
    // Callers MUST use this for action gating — do not infer from role alone.
    const effectivePermissions = await getEffectiveDocumentPermissions(
      {
        user: {
          id: session.user.id,
          roles: session.user.roles,
          permissions: session.user.permissions,
          department: session.user.department,
        },
      },
      document.id
    );

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    writeAudit({
      userId: session.user.id,
      action: "document.detail_viewed",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        referenceNumber: document.referenceNumber,
        title: document.title,
      },
    });

    return NextResponse.json(
      serialiseBigInt({
        ...document,
        auditLogs,
        effectivePermissions,
        casefolder,
      })
    );
  } catch (error) {
    logger.error("Failed to get document", error, {
      route: "/api/documents/[id]",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/documents/[id] — update document metadata
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
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;
    const body = await req.json();
    const { title, description, classificationNodeId, tags, metadata } = body;

    // Verify document exists
    const existing = await db.document.findUnique({
      where: { id },
      select: { id: true, status: true, title: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (existing.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Cannot update a disposed document" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (classificationNodeId !== undefined) updateData.classificationNodeId = classificationNodeId || null;
    if (metadata !== undefined) updateData.metadata = metadata;

    const document = await db.$transaction(async (tx) => {
      // Update document
      const doc = await tx.document.update({
        where: { id },
        data: updateData,
        include: {
          createdBy: { select: { id: true, name: true, displayName: true } },
          files: true,
          tags: true,
        },
      });

      // Replace tags if provided
      if (tags !== undefined && Array.isArray(tags)) {
        // Delete existing tags
        await tx.documentTag.deleteMany({ where: { documentId: id } });

        // Create new tags
        const uniqueTags = [...new Set(tags.map((t: string) => t.trim()).filter(Boolean))];
        if (uniqueTags.length > 0) {
          await tx.documentTag.createMany({
            data: uniqueTags.map((tag) => ({ documentId: id, tag })),
          });
        }
      }

      return doc;
    });

    // Reload with updated tags
    const updated = await db.document.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, displayName: true } },
        files: true,
        tags: true,
      },
    });

    const changedFields = Object.keys(updateData);
    if (tags !== undefined) changedFields.push("tags");
    await writeAudit({
      userId: session.user.id,
      action: "document.edited",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        changedFields,
        tagsUpdated: tags !== undefined,
      },
    });

    logger.info("Document updated", {
      userId: session.user.id,
      action: "document.updated",
      route: `/api/documents/${id}`,
      method: "PATCH",
    });

    return NextResponse.json(serialiseBigInt(updated ?? document));
  } catch (error) {
    logger.error("Failed to update document", error, {
      route: "/api/documents/[id]",
      method: "PATCH",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/documents/[id] — soft-delete (set status to DISPOSED)
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

    const existing = await db.document.findUnique({
      where: { id },
      select: { id: true, status: true, referenceNumber: true, isOnLegalHold: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (existing.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Document is already disposed" },
        { status: 400 }
      );
    }

    if (existing.isOnLegalHold) {
      return NextResponse.json(
        { error: "Cannot dispose a document under legal hold" },
        { status: 400 }
      );
    }

    await db.document.update({
      where: { id },
      data: { status: "DISPOSED" },
    });

    await writeAudit({
      userId: session.user.id,
      action: "document.disposed",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: { referenceNumber: existing.referenceNumber },
    });
    await writeAudit({
      userId: session.user.id,
      action: "document.deleted",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: { referenceNumber: existing.referenceNumber },
    });

    logger.info("Document disposed", {
      userId: session.user.id,
      action: "document.disposed",
      route: `/api/documents/${id}`,
      method: "DELETE",
    });

    return NextResponse.json({ message: "Document disposed successfully" });
  } catch (error) {
    logger.error("Failed to delete document", error, {
      route: "/api/documents/[id]",
      method: "DELETE",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
