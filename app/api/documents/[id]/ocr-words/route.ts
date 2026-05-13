/**
 * GET /api/documents/[id]/ocr-words
 *
 * Returns per-word OCR bounding boxes for the document's primary PDF file,
 * grouped by page. Coords are normalised 0–1 (top-left origin) so the
 * client just multiplies by the rendered iframe/canvas size to position
 * highlight rectangles.
 *
 * Access control: enforces `buildDocumentAccessWhere` plus the effective
 * `canView` permission — matches the rest of the document detail routes.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { promises as fs } from "fs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const access = await buildDocumentAccessWhere(session);
    const doc = await db.document.findFirst({
      where: { AND: [{ id }, access] },
      select: {
        id: true,
        files: {
          orderBy: { uploadedAt: "desc" },
          take: 1,
          select: {
            id: true,
            storagePath: true,
            renditionPath: true,
            renditionStatus: true,
            mimeType: true,
            encryptionIv: true,
            encryptionTag: true,
            ocrWords: {
              orderBy: [{ page: "asc" }, { y: "asc" }, { x: "asc" }],
              select: {
                id: true,
                page: true,
                x: true,
                y: true,
                width: true,
                height: true,
                text: true,
                confidence: true,
              },
            },
          },
        },
      },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const file = doc.files[0];
    if (!file) {
      return NextResponse.json({ pages: [], pageSizes: [] });
    }

    // Bucket words by page.
    const byPage = new Map<number, typeof file.ocrWords>();
    for (const w of file.ocrWords) {
      const arr = byPage.get(w.page) ?? [];
      arr.push(w);
      byPage.set(w.page, arr);
    }

    // Read PDF page sizes (in PDF points) so the client knows the aspect
    // ratio of each page — useful when sizing the overlay canvas.
    let pageSizes: { page: number; width: number; height: number }[] = [];
    const usingRendition =
      file.mimeType !== "application/pdf" &&
      file.renditionStatus === "DONE" &&
      !!file.renditionPath;
    const sourceRelPath = usingRendition ? file.renditionPath! : file.storagePath;
    try {
      const absPath = path.join(process.cwd(), sourceRelPath);
      let pdfBytes: Buffer;
      if (!usingRendition && file.encryptionIv && file.encryptionTag) {
        const { decryptFileToBuffer } = await import("@/lib/encryption");
        pdfBytes = await decryptFileToBuffer(absPath, file.encryptionIv, file.encryptionTag);
      } else {
        pdfBytes = await fs.readFile(absPath);
      }
      const probe = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      pageSizes = probe.getPages().map((p, i) => ({
        page: i + 1,
        width: p.getWidth(),
        height: p.getHeight(),
      }));
    } catch {
      // non-fatal; client can still render normalised boxes without sizes.
    }

    const pages = Array.from(byPage.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([page, words]) => ({ page, words }));

    return NextResponse.json({
      fileId: file.id,
      pages,
      pageSizes,
    });
  } catch (error) {
    logger.error("Failed to load OCR words", error, {
      route: "/api/documents/[id]/ocr-words",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
