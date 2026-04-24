import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// GET /api/documents/[id]/versions/[versionId]/download
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

    const version = await db.documentVersion.findFirst({
      where: { id: versionId, documentId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), version.storagePath);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }

    const fileName = version.fileName ?? path.basename(version.storagePath);
    const mimeType = version.mimeType ?? "application/octet-stream";

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Version download failed", error, {
      route: "/api/documents/[id]/versions/[versionId]/download",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
