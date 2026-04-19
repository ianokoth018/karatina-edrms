import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import fs from "fs/promises";
import path from "path";

/** Allowed MIME types for document uploads. */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

/** Maximum file size: 2 GB */
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(serialiseBigInt);
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = serialiseBigInt(v);
    }
    return out;
  }
  return data;
}

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/versions — upload a new version
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify document exists
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true, status: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.status === "DISPOSED") {
      return NextResponse.json(
        { error: "Cannot add versions to a disposed document" },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const changeNote = (formData.get("changeNote") as string) || "New version uploaded";

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type "${file.type}" is not allowed` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds the 50 MB limit" },
        { status: 400 }
      );
    }

    // Get latest version number
    const latestVersion = await db.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { versionNum: "desc" },
      select: { versionNum: true },
    });

    const nextVersionNum = (latestVersion?.versionNum ?? 0) + 1;

    // Save file to disk
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), "uploads", "edrms", document.referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });

    // Add version number to filename to avoid collisions
    const ext = path.extname(file.name);
    const baseName = path.basename(file.name, ext);
    const versionedFileName = `${baseName}_v${nextVersionNum}${ext}`;
    const filePath = path.join(uploadDir, versionedFileName);
    await fs.writeFile(filePath, fileBuffer);
    const storagePath = `uploads/edrms/${document.referenceNumber}/${versionedFileName}`;

    // Create version and file records in a transaction
    const version = await db.$transaction(async (tx) => {
      const ver = await tx.documentVersion.create({
        data: {
          documentId: id,
          versionNum: nextVersionNum,
          storagePath,
          sizeBytes: BigInt(file.size),
          changeNote: changeNote.trim(),
          createdById: session.user.id,
        },
      });

      // Also create a new DocumentFile record
      await tx.documentFile.create({
        data: {
          documentId: id,
          storagePath,
          fileName: versionedFileName,
          mimeType: file.type,
          sizeBytes: BigInt(file.size),
          ocrStatus: "PENDING",
        },
      });

      return ver;
    });

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    await writeAudit({
      userId: session.user.id,
      action: "document.version_created",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        versionNum: nextVersionNum,
        fileName: versionedFileName,
        changeNote: changeNote.trim(),
      },
    });
    await writeAudit({
      userId: session.user.id,
      action: "document.version_uploaded",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        versionNumber: nextVersionNum,
        fileName: versionedFileName,
      },
    });

    logger.info("Document version created", {
      userId: session.user.id,
      action: "document.version_created",
      route: `/api/documents/${id}/versions`,
      method: "POST",
    });

    return NextResponse.json(serialiseBigInt(version), { status: 201 });
  } catch (error) {
    logger.error("Failed to create document version", error, {
      route: "/api/documents/[id]/versions",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
