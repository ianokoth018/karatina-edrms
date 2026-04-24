import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { autoVersion } from "@/lib/auto-version";
import fs from "fs/promises";
import path from "path";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

// ---------------------------------------------------------------------------
// PUT /api/documents/[id]/file  — replace document file (auto-versions)
// Streams multipart body directly to disk via busboy — no full-file RAM buffer.
// ---------------------------------------------------------------------------
export async function PUT(
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
      select: { id: true, referenceNumber: true, status: true, checkoutUserId: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (document.status === "DISPOSED") {
      return NextResponse.json({ error: "Cannot update a disposed document" }, { status: 400 });
    }

    // Enforce checkout ownership
    if (document.checkoutUserId && document.checkoutUserId !== session.user.id) {
      const isAdmin = (session.user as { roles?: string[] }).roles?.some(
        (r) => ["admin", "super_admin"].includes(r.toLowerCase())
      );
      if (!isAdmin) {
        return NextResponse.json({ error: "Document is checked out by another user" }, { status: 409 });
      }
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
    }
    if (!req.body) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    const { default: Busboy } = await import("busboy");
    const { createWriteStream, createReadStream } = await import("fs");
    const { pipeline } = await import("stream/promises");
    const { Readable } = await import("stream");

    const tmpDir = path.join(process.cwd(), "uploads", ".tmp");
    await fs.mkdir(tmpDir, { recursive: true });

    // Determine next version number before streaming starts
    const latestVersion = await db.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { versionNum: "desc" },
      select: { versionNum: true },
    });
    const nextNum = (latestVersion?.versionNum ?? 0) + 1;

    const uploadDir = path.join(process.cwd(), "uploads", "edrms", document.referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });

    return new Promise<Response>(async (resolve) => {
      const bb = Busboy({
        headers: { "content-type": contentType },
        limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 },
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
        if (!tmpPath) {
          resolve(NextResponse.json({ error: "file field is required" }, { status: 400 }));
          return;
        }
        if (limitHit) {
          await fs.unlink(tmpPath).catch(() => {});
          resolve(NextResponse.json({ error: "File exceeds the 10 GB limit" }, { status: 413 }));
          return;
        }
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          await fs.unlink(tmpPath).catch(() => {});
          resolve(NextResponse.json({ error: `File type "${mimeType}" is not allowed` }, { status: 400 }));
          return;
        }

        const changeNote = fields["changeNote"] || undefined;
        const ext = path.extname(origName);
        const base = path.basename(origName, ext);
        const diskFileName = `${base}_v${nextNum}${ext}`;
        const finalPath = path.join(uploadDir, diskFileName);
        const storagePath = `uploads/edrms/${document.referenceNumber}/${diskFileName}`;

        try {
          await fs.rename(tmpPath, finalPath).catch(async () => {
            await pipeline(createReadStream(tmpPath!), createWriteStream(finalPath));
            await fs.unlink(tmpPath!).catch(() => {});
          });

          const { versionId, versionNum } = await autoVersion(
            db as unknown as import("@prisma/client").PrismaClient,
            {
              documentId: id,
              storagePath,
              fileName: diskFileName,
              mimeType,
              sizeBytes: BigInt(actualSize),
              createdById: session.user.id,
              changeNote,
            }
          );

          const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
          const ua = req.headers.get("user-agent") ?? undefined;
          await writeAudit({
            userId: session.user.id,
            action: "document.file_replaced",
            resourceType: "Document",
            resourceId: id,
            ipAddress: ip,
            userAgent: ua,
            metadata: { versionNum, versionId, fileName: diskFileName, changeNote },
          });

          logger.info("Document file replaced (auto-versioned)", { userId: session.user.id, documentId: id, versionNum });

          resolve(NextResponse.json({
            message: "File replaced and new version created automatically",
            versionId,
            versionNum,
            fileName: diskFileName,
          }, { status: 201 }));
        } catch (err) {
          await fs.unlink(tmpPath!).catch(() => {});
          logger.error("File replace failed", err);
          resolve(NextResponse.json({ error: "Internal server error" }, { status: 500 }));
        }
      });

      bb.on("error", (err) => {
        logger.error("Busboy error during file replace", err);
        resolve(new NextResponse("Bad request", { status: 400 }));
      });

      Readable.fromWeb(req.body as import("stream/web").ReadableStream).pipe(bb);
    });
  } catch (error) {
    logger.error("File replace endpoint failed", error, { route: "/api/documents/[id]/file", method: "PUT" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
