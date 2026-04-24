import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { redactFile, type RedactionRegion } from "@/lib/redaction";
import path from "path";

// GET /api/documents/[id]/redact — list redacted versions
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const redactions = await db.documentRedaction.findMany({
    where: { documentId: id },
    include: { createdBy: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(redactions);
}

// POST /api/documents/[id]/redact
// Body: { fileId, regions: RedactionRegion[], reason? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as {
      fileId: string;
      regions: RedactionRegion[];
      reason?: string;
    };

    if (!body.fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    if (!Array.isArray(body.regions) || body.regions.length === 0) {
      return NextResponse.json({ error: "At least one redaction region is required" }, { status: 400 });
    }

    const docFile = await db.documentFile.findFirst({
      where: { id: body.fileId, documentId: id },
      select: { storagePath: true, fileName: true, mimeType: true, encryptionIv: true, encryptionTag: true },
    });
    if (!docFile) return NextResponse.json({ error: "File not found" }, { status: 404 });

    if (!docFile.mimeType.includes("pdf")) {
      return NextResponse.json({ error: "Redaction is only supported for PDF files" }, { status: 400 });
    }

    const sourcePath = path.join(process.cwd(), docFile.storagePath);
    const ext = path.extname(docFile.storagePath);
    const base = path.basename(docFile.storagePath, ext);
    const redactedName = `${base}.redacted_${Date.now()}${ext}`;
    const redactedStoragePath = docFile.storagePath.replace(path.basename(docFile.storagePath), redactedName);
    const redactedAbsPath = path.join(process.cwd(), redactedStoragePath);

    await redactFile(sourcePath, redactedAbsPath, body.regions, docFile.encryptionIv, docFile.encryptionTag);

    const record = await db.documentRedaction.create({
      data: {
        documentId: id,
        fileId: body.fileId,
        redactedPath: redactedStoragePath,
        regions: body.regions as unknown as import("@prisma/client").Prisma.InputJsonValue,
        reason: body.reason ?? null,
        createdById: session.user.id,
      },
    });

    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.redacted",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { fileId: body.fileId, regionCount: body.regions.length, reason: body.reason },
    });

    return NextResponse.json({
      id: record.id,
      redactedPath: redactedStoragePath,
      downloadUrl: `/api/files?path=${encodeURIComponent(redactedStoragePath)}&download=1`,
      regionCount: body.regions.length,
    }, { status: 201 });
  } catch (error) {
    logger.error("Redaction failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
