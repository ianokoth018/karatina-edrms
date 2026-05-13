import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { verifyDocEmbedToken } from "@/lib/embed-token";

/**
 * GET /embed/doc/[id]/file?token=...
 *
 * Streams the document's primary file (preferring the PDF rendition when
 * available) for in-iframe display. Authenticates via the signed embed
 * token from createDocEmbedToken; no session cookie required so the
 * viewer can be hosted cross-origin by external systems.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return new NextResponse("Missing token", { status: 401 });
    const v = verifyDocEmbedToken(token);
    if (!v.ok) return new NextResponse(`Invalid token: ${v.reason}`, { status: 401 });
    if (v.documentId !== id) {
      return new NextResponse("Token/document mismatch", { status: 403 });
    }

    const file = await db.documentFile.findFirst({
      where: { documentId: id, isArchival: false },
      orderBy: { uploadedAt: "asc" },
      select: {
        storagePath: true,
        fileName: true,
        renditionPath: true,
        renditionStatus: true,
        encryptionIv: true,
        encryptionTag: true,
        mimeType: true,
      },
    });
    if (!file) return new NextResponse("File not found", { status: 404 });

    // Prefer the PDF rendition when available — embed viewers handle PDF
    // better than Office formats.
    const useRendition =
      file.renditionStatus === "DONE" && !!file.renditionPath;
    const storagePath = useRendition ? file.renditionPath! : file.storagePath;
    const absolute = path.join(process.cwd(), storagePath);
    const contentType = useRendition
      ? "application/pdf"
      : file.mimeType || "application/octet-stream";

    let bytes: Buffer;
    if (!useRendition && file.encryptionIv && file.encryptionTag) {
      const { decryptFileToBuffer } = await import("@/lib/encryption");
      bytes = await decryptFileToBuffer(
        absolute,
        file.encryptionIv,
        file.encryptionTag
      );
    } else {
      bytes = await fs.readFile(absolute);
    }

    writeAudit({
      userId: v.userId,
      action: "document.viewed_embedded",
      resourceType: "Document",
      resourceId: id,
      metadata: { rendition: useRendition },
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${file.fileName ?? "document.pdf"}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    logger.error("Failed to stream embedded file", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}
