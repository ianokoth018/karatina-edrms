import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDecryptStream } from "@/lib/encryption";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { applyWatermark } from "@/lib/watermark";
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
      select: { encryptionIv: true, encryptionTag: true, fileName: true, documentId: true, renditionPath: true },
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

    const wantRendition = req.nextUrl.searchParams.get("rendition") === "1";
    const wantWatermark = req.nextUrl.searchParams.get("watermark") === "1";

    // If caller wants rendition, resolve the rendition path
    let servePath = absolutePath;
    let serveStoragePath = filePath;
    if (wantRendition && docFile.renditionPath) {
      servePath = path.join(process.cwd(), docFile.renditionPath);
      serveStoragePath = docFile.renditionPath;
    }

    const ext = path.extname(servePath).slice(1).toLowerCase();
    const contentType = wantRendition ? "application/pdf" : (MIME_MAP[ext] ?? "application/octet-stream");
    const fileName = docFile.fileName ?? path.basename(absolutePath);

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
      metadata: { path: filePath, forceDownload, mimeType: contentType, fileName },
    });

    // Watermarking requires buffering the whole PDF in memory.
    // For non-watermarked or non-PDF files, stream directly (no RAM overhead).
    const isPdfServe = contentType === "application/pdf";
    const needsBuffer = wantWatermark && isPdfServe;

    const { stat } = await import("fs/promises");
    const fileStat = await stat(servePath).catch(() => null);

    // Resolve encryption keys — rendition files are not encrypted (LibreOffice output)
    const useEncryption = !wantRendition && !!docFile.encryptionIv && !!docFile.encryptionTag;

    if (needsBuffer) {
      // Buffer + decrypt + watermark
      let rawBytes: Buffer;
      if (useEncryption) {
        const { decryptFileToBuffer } = await import("@/lib/encryption");
        rawBytes = await decryptFileToBuffer(servePath, docFile.encryptionIv!, docFile.encryptionTag!);
      } else {
        rawBytes = await fs.readFile(servePath);
      }

      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { displayName: true },
      });

      const doc = await db.document.findUnique({
        where: { id: docFile.documentId },
        select: {
          classificationNode: { select: { title: true } },
        },
      });

      const watermarked = await applyWatermark(rawBytes, {
        userName: user?.displayName ?? session.user.id,
        timestamp: new Date(),
        label: doc?.classificationNode?.title ?? undefined,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(watermarked.byteLength),
      };
      return new NextResponse(watermarked as unknown as BodyInit, { status: 200, headers });
    }

    // Streaming path (no watermark)
    const { createReadStream } = await import("fs");
    const readStream = createReadStream(servePath);

    let sourceStream: NodeJS.ReadableStream;
    if (useEncryption) {
      const { createDecryptStream } = await import("@/lib/encryption");
      const decipher = createDecryptStream(docFile.encryptionIv!, docFile.encryptionTag!);
      sourceStream = readStream.pipe(decipher);
    } else {
      sourceStream = readStream;
    }

    const { Readable } = await import("stream");
    const webStream = Readable.toWeb(sourceStream as import("stream").Readable) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (!useEncryption && fileStat) {
      headers["Content-Length"] = String(fileStat.size);
    }

    return new NextResponse(webStream, { status: 200, headers });
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
 * Streams multipart body directly to disk via busboy — no full-file RAM buffer.
 * Supports files up to 10 GB.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
    }
    if (!req.body) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

    const { default: Busboy } = await import("busboy");
    const { createWriteStream, createReadStream } = await import("fs");
    const { pipeline } = await import("stream/promises");
    const { Readable } = await import("stream");

    const tmpDir = path.join(process.cwd(), "uploads", ".tmp");
    await fs.mkdir(tmpDir, { recursive: true });

    return new Promise<Response>(async (resolve) => {
      const bb = Busboy({
        headers: { "content-type": contentType },
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
      });

      const fields: Record<string, string> = {};
      let tmpPath: string | null = null;
      let origName = "upload";
      let mimeType = "application/octet-stream";
      let actualSize = 0;
      let limitHit = false;

      bb.on("field", (name, val) => { fields[name] = val; });

      bb.on("file", (_field, fileStream, info) => {
        origName = info.filename || "upload";
        mimeType = info.mimeType || "application/octet-stream";
        tmpPath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const ws = createWriteStream(tmpPath);
        fileStream.on("data", (chunk: Buffer) => { actualSize += chunk.length; });
        fileStream.on("limit", () => { limitHit = true; });
        fileStream.pipe(ws);
      });

      bb.on("finish", async () => {
        // Validation
        if (!tmpPath) {
          resolve(NextResponse.json({ error: "File is required" }, { status: 400 }));
          return;
        }
        if (limitHit) {
          await fs.unlink(tmpPath).catch(() => {});
          resolve(NextResponse.json({ error: "File exceeds the 10 GB limit" }, { status: 413 }));
          return;
        }
        const documentId = fields["documentId"];
        if (!documentId) {
          await fs.unlink(tmpPath).catch(() => {});
          resolve(NextResponse.json({ error: "documentId is required" }, { status: 400 }));
          return;
        }

        try {
          const doc = await db.document.findUnique({ where: { id: documentId }, select: { id: true } });
          if (!doc) {
            await fs.unlink(tmpPath).catch(() => {});
            resolve(NextResponse.json({ error: "Document not found" }, { status: 404 }));
            return;
          }

          const uploadDir = path.join(process.cwd(), "uploads", "edrms");
          await fs.mkdir(uploadDir, { recursive: true });

          const ext = path.extname(origName);
          const safeName = `${documentId}_${Date.now()}${ext}`;
          const finalPath = path.join(uploadDir, safeName);
          const storagePath = `uploads/edrms/${safeName}`;

          // Rename is instant on same device; fall back to copy+delete cross-device
          await fs.rename(tmpPath, finalPath).catch(async () => {
            await pipeline(createReadStream(tmpPath!), createWriteStream(finalPath));
            await fs.unlink(tmpPath!).catch(() => {});
          });

          const docFile = await db.documentFile.create({
            data: {
              documentId,
              fileName: origName,
              mimeType,
              sizeBytes: BigInt(actualSize),
              storagePath,
            },
          });

          if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
            const { enqueueOcr } = await import("@/lib/queue");
            await enqueueOcr(docFile.id);
          }
          if (mimeType !== "application/pdf") {
            const { isRenderable, generateRendition } = await import("@/lib/rendition");
            if (isRenderable(mimeType)) {
              setImmediate(() => generateRendition(docFile.id).catch(() => {}));
            }
          }

          resolve(NextResponse.json({
            id: docFile.id,
            fileName: docFile.fileName,
            mimeType: docFile.mimeType,
            sizeBytes: Number(docFile.sizeBytes),
            storagePath: docFile.storagePath,
          }, { status: 201 }));
        } catch (err) {
          await fs.unlink(tmpPath!).catch(() => {});
          logger.error("Upload post-processing failed", err);
          resolve(new NextResponse("Internal server error", { status: 500 }));
        }
      });

      bb.on("error", (err) => {
        logger.error("Busboy error during upload", err);
        resolve(new NextResponse("Bad request", { status: 400 }));
      });

      Readable.fromWeb(req.body as import("stream/web").ReadableStream).pipe(bb);
    });
  } catch (error) {
    logger.error("Failed to serve upload endpoint", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
