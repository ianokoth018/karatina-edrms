import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { decryptFileToBuffer } from "@/lib/encryption";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  tiff: "image/tiff",
  tif: "image/tiff",
  txt: "text/plain",
  xml: "application/xml",
};

/**
 * GET /api/shared/[token] — public viewer endpoint.
 *
 * No auth required: the unguessable 32-byte token IS the authentication. The
 * route validates that the link exists, is not revoked, and is not expired,
 * then streams the decrypted primary file of the document. Access counts and
 * timestamps are incremented per hit, and every access is audited with IP +
 * user-agent for traceability.
 *
 * Query:
 *   - ?download=1 — request attachment disposition. Only honoured when the
 *     link was granted canDownload; otherwise falls back to inline.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const link = await db.documentShareLink.findUnique({
      where: { token },
      select: {
        id: true,
        documentId: true,
        canDownload: true,
        canPrint: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!link) {
      return new NextResponse("Share link not found", { status: 404 });
    }

    if (link.revokedAt) {
      return new NextResponse("Share link has been revoked", { status: 410 });
    }

    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      return new NextResponse("Share link has expired", { status: 410 });
    }

    // Load the primary DocumentFile — prefer the most recent upload.
    const docFile = await db.documentFile.findFirst({
      where: { documentId: link.documentId },
      orderBy: { uploadedAt: "desc" },
      select: {
        storagePath: true,
        encryptionIv: true,
        encryptionTag: true,
        fileName: true,
        mimeType: true,
      },
    });

    if (!docFile) {
      return new NextResponse("No file attached to this document", {
        status: 404,
      });
    }

    // Security: keep within uploads/ — mirrors /api/files behaviour.
    const normalised = path.normalize(docFile.storagePath);
    if (normalised.includes("..") || !normalised.startsWith("uploads/")) {
      return new NextResponse("Invalid storage path", { status: 500 });
    }
    const absolutePath = path.join(process.cwd(), normalised);

    const buffer = await decryptFileToBuffer(
      absolutePath,
      docFile.encryptionIv ?? null,
      docFile.encryptionTag ?? null
    );

    const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
    const disposition = wantsDownload && link.canDownload ? "attachment" : "inline";

    const ext = path.extname(absolutePath).slice(1).toLowerCase();
    const contentType =
      docFile.mimeType || MIME_MAP[ext] || "application/octet-stream";
    const fileName = docFile.fileName ?? path.basename(absolutePath);

    // Best-effort: bump access counters. Never block the response on failure.
    try {
      await db.documentShareLink.update({
        where: { id: link.id },
        data: {
          accessCount: { increment: 1 },
          lastAccessAt: new Date(),
        },
      });
    } catch (err) {
      logger.error("Failed to increment share link access", err, {
        linkId: link.id,
      });
    }

    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    await writeAudit({
      userId: undefined, // anonymous — token is the auth
      action: "document.shared_link_accessed",
      resourceType: "Document",
      resourceId: link.documentId,
      ipAddress: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        linkId: link.id,
        ip,
        userAgent,
        download: disposition === "attachment",
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Failed to serve shared document", error, {
      route: "/api/shared/[token]",
      method: "GET",
    });
    return new NextResponse("Internal server error", { status: 500 });
  }
}
