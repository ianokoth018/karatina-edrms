import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { processFileOcr } from "@/lib/ocr";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/ocr — trigger OCR processing for a document
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

    // Find the document with its files
    const document = await db.document.findUnique({
      where: { id },
      include: {
        files: {
          where: {
            mimeType: {
              in: [
                "application/pdf",
                "image/jpeg",
                "image/png",
                "image/tiff",
              ],
            },
          },
          orderBy: { uploadedAt: "asc" },
          take: 1,
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.files.length === 0) {
      return NextResponse.json(
        { error: "No PDF or image file found for OCR processing" },
        { status: 400 }
      );
    }

    const file = document.files[0];

    // Run real OCR / text extraction
    await processFileOcr(file.id);

    // Reload the updated file record
    const updated = await db.documentFile.findUnique({
      where: { id: file.id },
      select: { ocrText: true, ocrStatus: true },
    });

    await db.document.update({ where: { id }, data: { updatedAt: new Date() } });

    await writeAudit({
      userId: session.user.id,
      action: "document.ocr_processed",
      resourceType: "Document",
      resourceId: id,
      metadata: {
        fileId: file.id,
        fileName: file.fileName,
        ocrStatus: updated?.ocrStatus,
        characterCount: updated?.ocrText?.length ?? 0,
      },
    });

    logger.info("OCR processing completed", {
      userId: session.user.id,
      action: "document.ocr_processed",
      route: `/api/documents/${id}/ocr`,
      method: "POST",
    });

    return NextResponse.json({
      success: true,
      ocrStatus: updated?.ocrStatus,
      characterCount: updated?.ocrText?.length ?? 0,
    });
  } catch (error) {
    logger.error("OCR processing failed", error, {
      route: "/api/documents/[id]/ocr",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/documents/[id]/ocr — get OCR status/text for a document
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
        files: {
          where: {
            ocrStatus: { in: ["COMPLETE", "PROCESSING", "FAILED"] },
          },
          orderBy: { uploadedAt: "asc" },
          take: 1,
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const file = document.files[0];

    if (!file || !file.ocrText) {
      return NextResponse.json({
        hasOcr: false,
        ocrText: null,
        ocrStatus: file?.ocrStatus ?? "PENDING",
        processedAt: null,
      });
    }

    return NextResponse.json({
      hasOcr: true,
      ocrText: file.ocrText,
      ocrStatus: file.ocrStatus,
      processedAt: document.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error("Failed to get OCR status", error, {
      route: "/api/documents/[id]/ocr",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
