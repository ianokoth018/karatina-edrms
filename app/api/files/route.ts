import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptFileToBuffer } from "@/lib/encryption";
import path from "path";

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
      select: { encryptionIv: true, encryptionTag: true, fileName: true },
    });

    // Decrypt the file (handles both encrypted and unencrypted legacy files)
    const buffer = await decryptFileToBuffer(
      absolutePath,
      docFile?.encryptionIv ?? null,
      docFile?.encryptionTag ?? null
    );

    const ext = path.extname(absolutePath).slice(1).toLowerCase();
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";
    const fileName = docFile?.fileName ?? path.basename(absolutePath);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store", // encrypted files should not be cached
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Internal server error", { status: 500 });
  }
}
