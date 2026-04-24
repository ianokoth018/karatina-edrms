import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// POST /api/documents/[id]/move
// Body: { department?, classificationNodeId?, casefolderMetadata? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isPrivileged = (session.user as { roles?: string[] }).roles?.some(
      (r) => ["admin", "super_admin", "records_manager"].includes(r.toLowerCase())
    );
    if (!isPrivileged) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    const { id } = await params;
    const body = await req.json() as {
      department?: string;
      classificationNodeId?: string | null;
      copy?: boolean; // true = copy, false/absent = move
    };

    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true, department: true, classificationNodeId: true, status: true },
    });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (doc.status === "DISPOSED") return NextResponse.json({ error: "Cannot move a disposed document" }, { status: 400 });

    if (body.classificationNodeId !== undefined) {
      // Verify node exists if provided
      if (body.classificationNodeId) {
        const node = await db.classificationNode.findUnique({ where: { id: body.classificationNodeId }, select: { id: true } });
        if (!node) return NextResponse.json({ error: "Classification node not found" }, { status: 404 });
      }
    }

    if (body.copy) {
      // Create a shallow copy — same files via new DocumentFile references
      const { generateReference } = await import("@/lib/reference");
      const newRef = await generateReference("DOC", body.department ?? doc.department);

      const original = await db.document.findUnique({
        where: { id },
        include: { files: true, tags: true },
      });
      if (!original) return NextResponse.json({ error: "Document not found" }, { status: 404 });

      const copy = await db.$transaction(async (tx) => {
        const newDoc = await tx.document.create({
          data: {
            referenceNumber: newRef,
            title: `${original.title} (copy)`,
            description: original.description,
            documentType: original.documentType,
            department: body.department ?? original.department,
            classificationNodeId: body.classificationNodeId !== undefined
              ? body.classificationNodeId
              : original.classificationNodeId,
            createdById: session.user.id,
            sourceSystem: "MANUAL",
            metadata: original.metadata ?? {},
          },
        });

        if (original.files.length > 0) {
          await tx.documentFile.createMany({
            data: original.files.map((f) => ({
              documentId: newDoc.id,
              storagePath: f.storagePath,
              fileName: f.fileName,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              encryptionIv: f.encryptionIv,
              encryptionTag: f.encryptionTag,
              ocrText: f.ocrText,
              ocrStatus: f.ocrStatus,
            })),
          });
        }

        if (original.tags.length > 0) {
          await tx.documentTag.createMany({
            data: original.tags.map((t) => ({ documentId: newDoc.id, tag: t.tag })),
          });
        }

        return newDoc;
      });

      await writeAudit({
        userId: session.user.id,
        action: "document.copied",
        resourceType: "Document",
        resourceId: id,
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        metadata: { newDocumentId: copy.id, newReferenceNumber: newRef, targetDepartment: body.department },
      });

      return NextResponse.json({ message: "Document copied", newDocumentId: copy.id, referenceNumber: newRef }, { status: 201 });
    }

    // Move: update department and/or classification in place
    const updateData: Record<string, unknown> = {};
    if (body.department !== undefined) updateData.department = body.department;
    if (body.classificationNodeId !== undefined) updateData.classificationNodeId = body.classificationNodeId;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nothing to update — provide department or classificationNodeId" }, { status: 400 });
    }

    const updated = await db.document.update({ where: { id }, data: updateData });

    await writeAudit({
      userId: session.user.id,
      action: "document.moved",
      resourceType: "Document",
      resourceId: id,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
      metadata: {
        from: { department: doc.department, classificationNodeId: doc.classificationNodeId },
        to: updateData,
      },
    });

    return NextResponse.json({ message: "Document moved", document: updated });
  } catch (error) {
    logger.error("Document move/copy failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
