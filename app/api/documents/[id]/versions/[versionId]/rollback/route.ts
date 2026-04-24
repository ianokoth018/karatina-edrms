import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { markLatest } from "@/lib/version-control";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/versions/[versionId]/rollback
// Creates a new version that is a copy of the target version's file.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

    const [document, targetVersion] = await Promise.all([
      db.document.findUnique({
        where: { id },
        select: { id: true, referenceNumber: true, status: true },
      }),
      db.documentVersion.findFirst({ where: { id: versionId, documentId: id } }),
    ]);

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (!targetVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    if (document.status === "DISPOSED") {
      return NextResponse.json({ error: "Cannot rollback a disposed document" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as { changeNote?: string };

    const latestVersion = await db.documentVersion.findFirst({
      where: { documentId: id },
      orderBy: { versionNum: "desc" },
      select: { versionNum: true },
    });
    const nextVersionNum = (latestVersion?.versionNum ?? 0) + 1;

    // Copy the storage file with a new versioned name
    const uploadDir = path.join(process.cwd(), "uploads", "edrms", document.referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = targetVersion.fileName ? path.extname(targetVersion.fileName) : ".bin";
    const base = targetVersion.fileName ? path.basename(targetVersion.fileName, ext) : "document";
    const newFileName = `${base}_v${nextVersionNum}${ext}`;
    const newStoragePath = `uploads/edrms/${document.referenceNumber}/${newFileName}`;

    const srcPath = path.join(process.cwd(), targetVersion.storagePath);
    const destPath = path.join(uploadDir, newFileName);
    await fs.copyFile(srcPath, destPath);

    const newVersion = await db.$transaction(async (tx) => {
      const ver = await tx.documentVersion.create({
        data: {
          documentId: id,
          versionNum: nextVersionNum,
          storagePath: newStoragePath,
          sizeBytes: targetVersion.sizeBytes,
          mimeType: targetVersion.mimeType,
          fileName: newFileName,
          changeNote: body.changeNote ?? `Rolled back to version ${targetVersion.versionNum}`,
          createdById: session.user.id,
          status: "DRAFT",
          parentVersionId: versionId,
        },
      });

      await tx.documentFile.create({
        data: {
          documentId: id,
          storagePath: newStoragePath,
          fileName: newFileName,
          mimeType: targetVersion.mimeType ?? "application/octet-stream",
          sizeBytes: targetVersion.sizeBytes,
          ocrStatus: "PENDING",
        },
      });

      return ver;
    });

    await markLatest(db, id, newVersion.id);

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.version_rollback",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: {
        rolledBackTo: targetVersion.versionNum,
        newVersionNum: nextVersionNum,
        newVersionId: newVersion.id,
      },
    });

    logger.info("Document rolled back", {
      userId: session.user.id,
      documentId: id,
      rolledBackTo: targetVersion.versionNum,
      newVersion: nextVersionNum,
    });

    return NextResponse.json({
      message: `Rolled back to version ${targetVersion.versionNum}`,
      newVersionId: newVersion.id,
      newVersionNum: nextVersionNum,
    }, { status: 201 });
  } catch (error) {
    logger.error("Version rollback failed", error, {
      route: "/api/documents/[id]/versions/[versionId]/rollback",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
