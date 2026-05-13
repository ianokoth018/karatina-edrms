import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { classifyDocument } from "@/lib/ai-classify";
import { aiEnabled } from "@/lib/ai-client";

/**
 * POST /api/documents/[id]/ai-classify
 *
 * Run AI classification against the document's OCR text. Returns the
 * suggested fields for the user to accept or edit on the detail page;
 * does NOT mutate the document — apply via the existing PATCH endpoint.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!aiEnabled()) {
      return NextResponse.json(
        { error: "AI is not configured on this server" },
        { status: 503 }
      );
    }
    const { id } = await params;

    const doc = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        department: true,
        documentType: true,
        files: {
          where: { ocrText: { not: null } },
          orderBy: { uploadedAt: "asc" },
          take: 1,
          select: { fileName: true, ocrText: true },
        },
      },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const ocr = doc.files[0]?.ocrText;
    if (!ocr) {
      return NextResponse.json(
        {
          error: "No OCR text available — wait for capture to finish, or run OCR on this document first.",
        },
        { status: 409 }
      );
    }

    const result = await classifyDocument({
      ocrText: ocr,
      fileName: doc.files[0]?.fileName ?? undefined,
      hints: {
        currentDepartment: doc.department,
        currentType: doc.documentType,
      },
    });

    if (!result) {
      return NextResponse.json(
        { error: "AI returned no usable result." },
        { status: 502 }
      );
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.ai_classified",
      resourceType: "Document",
      resourceId: id,
      metadata: {
        suggestedType: result.documentType,
        confidence: result.confidence,
      },
    });

    return NextResponse.json({ suggestion: result });
  } catch (error) {
    logger.error("AI classification failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
