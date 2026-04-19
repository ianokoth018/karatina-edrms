import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

/**
 * Custom JSON serialiser that converts BigInt values to strings so that
 * `JSON.stringify` does not throw.
 */
function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
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
// GET /api/records/casefolders/[id]/[docId] — single document with full
// metadata, files, versions, and the casefolder template fields.
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, docId } = await params;

    // Fetch the form template (casefolder definition)
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fields: true,
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Casefolder not found" },
        { status: 404 }
      );
    }

    // Fetch the document and verify it belongs to this casefolder
    const document = await db.document.findUnique({
      where: { id: docId },
      include: {
        createdBy: {
          select: { id: true, name: true, displayName: true, department: true },
        },
        files: {
          select: {
            id: true,
            storagePath: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
        versions: {
          orderBy: { versionNum: "desc" },
          select: {
            id: true,
            versionNum: true,
            storagePath: true,
            sizeBytes: true,
            changeNote: true,
            createdById: true,
            createdAt: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Verify the document belongs to this casefolder
    const metadata = document.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.formTemplateId !== id) {
      return NextResponse.json(
        { error: "Document does not belong to this casefolder" },
        { status: 404 }
      );
    }

    // Extract field values from metadata, mapping to template field names.
    // Metadata has camelCase keys (from XML capture), template has snake_case names.
    // We use _fieldLabels to match by original XML label as well.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templateFields = (template.fields ?? []) as any[];
    const rawLabels = ((metadata._fieldLabels ?? {}) as Record<string, string>);
    const fieldValues: Record<string, unknown> = {};

    for (const field of templateFields) {
      const fname = field.name as string;
      const flabel = field.label as string;
      const xmlName = (field.xmlFieldName as string) || "";

      // 1. Direct match by field name
      if (metadata[fname] !== undefined) { fieldValues[fname] = metadata[fname]; continue; }
      // 2. Match by xmlFieldName in _fieldLabels
      if (xmlName && rawLabels[xmlName] !== undefined) { fieldValues[fname] = rawLabels[xmlName]; continue; }
      // 3. Match by label in _fieldLabels
      if (flabel && rawLabels[flabel] !== undefined) { fieldValues[fname] = rawLabels[flabel]; continue; }
      // 4. Try camelCase version of snake_case field name
      const camelCase = fname.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      if (metadata[camelCase] !== undefined) { fieldValues[fname] = metadata[camelCase]; continue; }
    }

    // Compute effective permissions for this user on this document so the UI
    // can gate action buttons without a second round-trip.
    const effectivePermissions = await getEffectiveDocumentPermissions(
      session,
      document.id
    );

    return NextResponse.json(
      serialiseBigInt({
        document: {
          id: document.id,
          referenceNumber: document.referenceNumber,
          title: document.title,
          description: document.description,
          documentType: document.documentType,
          status: document.status,
          department: document.department,
          metadata: document.metadata,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          createdBy: document.createdBy,
          files: document.files,
          versions: document.versions,
          effectivePermissions,
        },
        casefolder: {
          id: template.id,
          name: template.name,
          fields: template.fields,
        },
        fieldValues,
      })
    );
  } catch (error) {
    logger.error("Failed to get casefolder document", error, {
      route: "/api/records/casefolders/[id]/[docId]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/casefolders/[id]/[docId] — update document metadata
// field values. Merges into existing metadata keeping formTemplateId intact.
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, docId } = await params;

    const body = await req.json();
    const { fieldValues } = body as {
      fieldValues?: Record<string, unknown>;
    };

    if (!fieldValues || typeof fieldValues !== "object") {
      return NextResponse.json(
        { error: "fieldValues object is required" },
        { status: 400 }
      );
    }

    // Verify the form template exists
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

    // Fetch the document
    const document = await db.document.findUnique({
      where: { id: docId },
      select: { id: true, metadata: true },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Verify the document belongs to this casefolder
    const existingMetadata =
      (document.metadata as Record<string, unknown>) ?? {};
    if (existingMetadata.formTemplateId !== id) {
      return NextResponse.json(
        { error: "Document does not belong to this casefolder" },
        { status: 404 }
      );
    }

    // Prevent overwriting formTemplateId via fieldValues
    const sanitised = { ...fieldValues };
    delete sanitised.formTemplateId;

    // Merge new field values into existing metadata
    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      ...sanitised,
    };

    const updated = await db.document.update({
      where: { id: docId },
      data: {
        metadata: updatedMetadata as Record<string, never>,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, displayName: true },
        },
        files: {
          select: { id: true, fileName: true, mimeType: true },
        },
      },
    });

    // Write audit log
    await writeAudit({
      userId: session.user.id,
      action: "casefolder.document_updated",
      resourceType: "Document",
      resourceId: docId,
      metadata: {
        casefolderId: id,
        casefolderName: template.name,
        updatedFields: Object.keys(sanitised),
      },
    });

    logger.info("Casefolder document metadata updated", {
      userId: session.user.id,
      action: "casefolder.document_updated",
      route: `/api/records/casefolders/${id}/${docId}`,
      method: "PATCH",
    });

    return NextResponse.json(serialiseBigInt(updated));
  } catch (error) {
    logger.error("Failed to update casefolder document", error, {
      route: "/api/records/casefolders/[id]/[docId]",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
