import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// POST /api/documents/bulk-export
// Body: { documentIds: string[], includeMetadata?: boolean }
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { documentIds?: string[]; includeMetadata?: boolean };
    if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) {
      return NextResponse.json({ error: "documentIds is required" }, { status: 400 });
    }
    if (body.documentIds.length > 50) {
      return NextResponse.json({ error: "Maximum 50 documents per export" }, { status: 400 });
    }

    const docs = await db.document.findMany({
      where: { id: { in: body.documentIds } },
      include: {
        files: { take: 1, orderBy: { uploadedAt: "desc" } },
        tags: true,
        classificationNode: { select: { code: true, title: true } },
        createdBy: { select: { displayName: true } },
      },
    });

    if (docs.length === 0) return NextResponse.json({ error: "No documents found" }, { status: 404 });

    // Build a temp directory with the files + optional metadata JSON
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edrms-export-"));

    try {
      for (const doc of docs) {
        if (doc.files.length === 0) continue;
        const f = doc.files[0];
        const srcPath = path.join(process.cwd(), f.storagePath);

        let fileBytes: Buffer;
        if (f.encryptionIv && f.encryptionTag) {
          const { decryptFileToBuffer } = await import("@/lib/encryption");
          fileBytes = await decryptFileToBuffer(srcPath, f.encryptionIv, f.encryptionTag);
        } else {
          fileBytes = await fs.readFile(srcPath).catch(() => Buffer.alloc(0));
        }

        const safeName = `${doc.referenceNumber}_${f.fileName}`.replace(/[^a-zA-Z0-9._\-]/g, "_");
        await fs.writeFile(path.join(tmpDir, safeName), fileBytes);
      }

      if (body.includeMetadata !== false) {
        const metadata = docs.map((d) => ({
          id: d.id,
          referenceNumber: d.referenceNumber,
          title: d.title,
          documentType: d.documentType,
          department: d.department,
          status: d.status,
          classification: d.classificationNode,
          tags: d.tags.map((t) => t.tag),
          createdBy: d.createdBy.displayName,
          createdAt: d.createdAt.toISOString(),
        }));
        await fs.writeFile(
          path.join(tmpDir, "metadata.json"),
          JSON.stringify(metadata, null, 2)
        );
      }

      // Use zip to bundle
      const zipPath = tmpDir + ".zip";
      await execFileAsync("zip", ["-r", "-j", zipPath, tmpDir + "/"], { timeout: 30_000 });

      const zipBytes = await fs.readFile(zipPath);
      await fs.rm(tmpDir, { recursive: true }).catch(() => null);
      await fs.unlink(zipPath).catch(() => null);

      const ts = new Date().toISOString().slice(0, 10);
      const fileName = `edrms-export-${ts}.zip`;

      await writeAudit({
        userId: session.user.id,
        action: "document.bulk_exported",
        resourceType: "Document",
        resourceId: body.documentIds[0],
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        metadata: { count: docs.length, documentIds: body.documentIds },
      });

      return new NextResponse(zipBytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(zipBytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true }).catch(() => null);
      throw err;
    }
  } catch (error) {
    logger.error("Bulk export failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
