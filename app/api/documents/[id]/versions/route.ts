import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { notifyVersionUploaded } from "@/lib/version-notifications";
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
// GET /api/documents/[id]/versions — list all versions
// ---------------------------------------------------------------------------
export async function GET(
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
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const versions = await db.documentVersion.findMany({
      where: { documentId: id },
      orderBy: { versionNum: "desc" },
      include: {
        approvedBy: { select: { name: true, displayName: true } },
      },
    });

    const creatorIds = [...new Set(versions.map((v) => v.createdById))];
    const creators = await db.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, name: true, displayName: true },
    });
    const creatorMap = Object.fromEntries(creators.map((u) => [u.id, u]));

    const payload = versions.map((v) => ({
      ...v,
      createdBy: creatorMap[v.createdById] ?? null,
      downloadUrl: `/api/documents/${id}/versions/${v.id}/download`,
    }));

    return NextResponse.json(serialiseBigInt(payload));
  } catch (error) {
    logger.error("Failed to list document versions", error, {
      route: "/api/documents/[id]/versions",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
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

    const latestVersion = await db.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { versionNum: "desc" },
      select: { versionNum: true },
    });

    const nextVersionNum = (latestVersion?.versionNum ?? 0) + 1;

    const uploadDir = path.join(process.cwd(), "uploads", "edrms", document.referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = path.extname(file.name);
    const baseName = path.basename(file.name, ext);
    const versionedFileName = `${baseName}_v${nextVersionNum}${ext}`;
    const filePath = path.join(uploadDir, versionedFileName);

    const { Readable } = await import("stream");
    const { createWriteStream } = await import("fs");
    const { pipeline } = await import("stream/promises");
    const writeStream = createWriteStream(filePath);
    const nodeReadable = Readable.fromWeb(file.stream() as import("stream/web").ReadableStream);
    await pipeline(nodeReadable, writeStream);
    const storagePath = `uploads/edrms/${document.referenceNumber}/${versionedFileName}`;

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

    const uploader = await db.user.findUnique({
      where: { id: session.user.id },
      select: { displayName: true },
    });

    await notifyVersionUploaded(
      db,
      id,
      nextVersionNum,
      uploader?.displayName ?? session.user.id
    ).catch((err) =>
      logger.warn("notifyVersionUploaded failed", { err: String(err) })
    );

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
