import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import { aiEnabled } from "@/lib/ai-client";
import { detectPii } from "@/lib/ai-redact";

/**
 * POST /api/documents/[id]/ai-redact
 *
 * Run AI PII detection against the document's OCR text. Returns suggested
 * text spans for the user to locate and redact manually in the canvas UI;
 * does NOT mutate the document — applying a redaction still goes through
 * /api/documents/[id]/redactions.
 *
 * 503 when AI is not configured. 409 when the document has no OCR text.
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

    // Enforce classification + ACL — caller must already be able to read
    // the document. Reuses the same predicate as the document detail page.
    const access = await buildDocumentAccessWhere(session);
    const doc = await db.document.findFirst({
      where: { AND: [{ id }, access] },
      select: {
        id: true,
        files: {
          where: { ocrText: { not: null } },
          orderBy: { uploadedAt: "asc" },
          take: 1,
          select: { ocrText: true },
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
          error:
            "No OCR text available — wait for capture to finish, or run OCR on this document first.",
        },
        { status: 409 }
      );
    }

    const suggestions = await detectPii({ ocrText: ocr, documentId: id });
    if (suggestions === null) {
      // Provider configured at boot but returned no result — treat as soft
      // failure so the UI can tell the user to retry.
      return NextResponse.json(
        { error: "AI returned no usable result." },
        { status: 502 }
      );
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.ai_redaction_proposed",
      resourceType: "Document",
      resourceId: id,
      metadata: { count: suggestions.length },
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    logger.error("AI redaction proposal failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
