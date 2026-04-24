// app/api/upload/tus/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createUpload,
  getUpload,
  appendChunk,
  getAssembledPath,
  deleteUpload,
  decodeTusMetadata,
} from "@/lib/tus-store";
import { promises as fs } from "fs";
import path from "path";

const TUS_VERSION = "1.0.0";
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

function tusHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Tus-Resumable": TUS_VERSION,
    "Tus-Version": TUS_VERSION,
    ...extra,
  };
}

// OPTIONS — announce capabilities
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: tusHeaders({
      "Tus-Max-Size": String(MAX_SIZE),
      "Tus-Extension": "creation,termination",
      "Access-Control-Allow-Methods": "OPTIONS,POST,HEAD,PATCH,DELETE",
      "Access-Control-Allow-Headers":
        "Content-Type,Upload-Length,Upload-Metadata,Upload-Offset,Tus-Resumable",
      "Access-Control-Expose-Headers":
        "Location,Upload-Offset,Upload-Length,Tus-Resumable",
    }),
  });
}

// POST — create a new upload
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const lengthHeader = req.headers.get("Upload-Length");
  if (!lengthHeader) {
    return new NextResponse("Upload-Length is required", {
      status: 400,
      headers: tusHeaders(),
    });
  }

  const length = parseInt(lengthHeader, 10);
  if (isNaN(length) || length <= 0 || length > MAX_SIZE) {
    return new NextResponse("Invalid Upload-Length", {
      status: 400,
      headers: tusHeaders(),
    });
  }

  const metadata = decodeTusMetadata(req.headers.get("Upload-Metadata"));
  const upload = await createUpload(length, metadata);

  const location = `/api/upload/tus?id=${upload.uploadId}`;
  return new NextResponse(null, {
    status: 201,
    headers: tusHeaders({ Location: location }),
  });
}

// HEAD — return current offset
export async function HEAD(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const uploadId = req.nextUrl.searchParams.get("id");
  if (!uploadId) return new NextResponse("Missing id", { status: 400 });

  const upload = await getUpload(uploadId);
  if (!upload) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(null, {
    status: 200,
    headers: tusHeaders({
      "Upload-Offset": String(upload.offset),
      "Upload-Length": String(upload.length),
      "Cache-Control": "no-store",
    }),
  });
}

// PATCH — upload a chunk
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const uploadId = req.nextUrl.searchParams.get("id");
  if (!uploadId) return new NextResponse("Missing id", { status: 400 });

  const contentType = req.headers.get("Content-Type");
  if (contentType !== "application/offset+octet-stream") {
    return new NextResponse("Invalid Content-Type", { status: 415 });
  }

  const offsetHeader = req.headers.get("Upload-Offset");
  if (offsetHeader === null) {
    return new NextResponse("Upload-Offset is required", { status: 400 });
  }
  const offset = parseInt(offsetHeader, 10);
  if (isNaN(offset)) return new NextResponse("Invalid Upload-Offset", { status: 400 });

  // Read the chunk from the request body
  const arrayBuffer = await req.arrayBuffer();
  const chunk = Buffer.from(arrayBuffer);

  let result: { newOffset: number; complete: boolean };
  try {
    result = await appendChunk(uploadId, chunk, offset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Conflict";
    return new NextResponse(msg, { status: 409, headers: tusHeaders() });
  }

  // If upload is complete, finalize: move file + create DB record
  if (result.complete) {
    const upload = await getUpload(uploadId);
    if (upload) {
      try {
        const documentId = upload.metadata.documentId;
        const fileName = upload.metadata.filename || `upload_${uploadId}`;
        const mimeType = upload.metadata.mimeType || "application/octet-stream";

        if (documentId) {
          // Verify document exists
          const doc = await db.document.findUnique({
            where: { id: documentId },
            select: { id: true },
          });

          if (doc) {
            const ext = path.extname(fileName);
            const safeName = `${documentId}_${Date.now()}${ext}`;
            const uploadDir = path.join(process.cwd(), "uploads", "edrms");
            await fs.mkdir(uploadDir, { recursive: true });
            const destPath = path.join(uploadDir, safeName);
            const storagePath = `uploads/edrms/${safeName}`;

            // Move assembled file from tus temp to uploads/edrms
            await fs.rename(getAssembledPath(uploadId), destPath);

            const docFile = await db.documentFile.create({
              data: {
                documentId,
                fileName,
                mimeType,
                sizeBytes: BigInt(upload.length),
                storagePath,
                ocrStatus: "PENDING",
              },
            });

            // Enqueue OCR via pg-boss — crash-safe, retried on failure
            if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
              const { enqueueOcr } = await import("@/lib/queue");
              await enqueueOcr(docFile.id);
            }

            // Clean up tus metadata (bin file already moved)
            await deleteUpload(uploadId).catch(() => {});
          }
        }
      } catch {
        // Log but don't fail the TUS response — client needs to know offset
      }
    }
  }

  return new NextResponse(null, {
    status: 204,
    headers: tusHeaders({ "Upload-Offset": String(result.newOffset) }),
  });
}

// DELETE — cancel upload
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const uploadId = req.nextUrl.searchParams.get("id");
  if (!uploadId) return new NextResponse("Missing id", { status: 400 });

  const upload = await getUpload(uploadId);
  if (!upload) return new NextResponse("Not found", { status: 404 });

  await deleteUpload(uploadId);
  return new NextResponse(null, { status: 204, headers: tusHeaders() });
}
