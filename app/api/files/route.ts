import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptFileToBuffer } from "@/lib/encryption";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";
import { processFileOcr } from "@/lib/ocr";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import path from "path";
import fs from "fs/promises";

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
 * GET /api/files?path=uploads/edrms/CAP-000001_file.pdf
 *
 * Serves files from the uploads directory with on-the-fly decryption.
 * Requires authentication. Files are stored encrypted at rest using AES-256-GCM.
 * The encryption IV and tag are stored in the DocumentFile record.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const filePath = req.nextUrl.searchParams.get("path");
    if (!filePath) {
      return new NextResponse("Missing path parameter", { status: 400 });
    }

    // Security: prevent directory traversal
    const normalised = path.normalize(filePath);
    if (normalised.includes("..") || !normalised.startsWith("uploads/")) {
      return new NextResponse("Invalid path", { status: 403 });
    }

    const absolutePath = path.join(process.cwd(), normalised);

    // Look up the DocumentFile record to get encryption IV/tag
    const docFile = await db.documentFile.findFirst({
      where: { storagePath: filePath },
      select: { encryptionIv: true, encryptionTag: true, fileName: true, documentId: true },
    });

    // If the file isn't in the DB, return 404 to avoid leaking existence.
    if (!docFile) {
      return new NextResponse("Not found", { status: 404 });
    }

    // ACL check BEFORE decryption/IO to avoid wasted work
    const forceDownload = req.nextUrl.searchParams.get("download") === "1";
    let perms;
    try {
      perms = await getEffectiveDocumentPermissions(session, docFile.documentId);
    } catch (permError) {
      logger.error("Permission resolution failed", permError, {
        route: "/api/files",
        documentId: docFile.documentId,
        userId: session.user.id,
      });
      return new NextResponse("Permission resolution failed", { status: 500 });
    }
    if (!perms.canView) {
      return new NextResponse("You do not have permission to access this file", { status: 403 });
    }
    if (forceDownload && !perms.canDownload) {
      return new NextResponse("You do not have download permission for this file", { status: 403 });
    }

    // Decrypt the file (handles both encrypted and unencrypted legacy files)
    const buffer = await decryptFileToBuffer(
      absolutePath,
      docFile.encryptionIv ?? null,
      docFile.encryptionTag ?? null
    );

    const ext = path.extname(absolutePath).slice(1).toLowerCase();
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";
    const fileName = docFile.fileName ?? path.basename(absolutePath);

    // Audit the view/download.  Records-management systems intentionally over-log;
    // this may include byte-range re-requests from the PDF viewer but each hit
    // still represents a real access event worth preserving.
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    writeAudit({
      userId: session.user.id,
      action: forceDownload ? "document.downloaded" : "document.viewed",
      resourceType: "Document",
      resourceId: docFile.documentId,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        path: filePath,
        forceDownload,
        mimeType: contentType,
        fileName,
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Failed to serve file", error, {
      route: "/api/files",
      method: "GET",
      path: req.nextUrl.searchParams.get("path"),
    });
    return new NextResponse("Internal server error", { status: 500 });
  }
}

/**
 * POST /api/files — upload a file and attach to a document
 *
 * Expects FormData with:
 *   - file: File
 *   - documentId: string
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const documentId = formData.get("documentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    if (!documentId) {
      return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }

    // Verify document exists
    const doc = await db.document.findUnique({ where: { id: documentId }, select: { id: true } });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Validate file size (2GB max per document)
    if (file.size > 2 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 2GB per document." }, { status: 400 });
    }

    // Save to disk
    const uploadDir = path.join(process.cwd(), "uploads", "edrms");
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = path.extname(file.name);
    const safeName = `${documentId}_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, safeName);
    const storagePath = `uploads/edrms/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Create DocumentFile record
    const docFile = await db.documentFile.create({
      data: {
        documentId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: BigInt(file.size),
        storagePath,
      },
    });

    // Kick off OCR/text-extraction in the background — don't block the response
    if (file.type === "application/pdf" || file.type.startsWith("image/")) {
      setImmediate(() => processFileOcr(docFile.id).catch(() => {}));
    }

    return NextResponse.json({
      id: docFile.id,
      fileName: docFile.fileName,
      mimeType: docFile.mimeType,
      sizeBytes: Number(docFile.sizeBytes),
      storagePath: docFile.storagePath,
    }, { status: 201 });
  } catch {
    return new NextResponse("Internal server error", { status: 500 });
  }
}
