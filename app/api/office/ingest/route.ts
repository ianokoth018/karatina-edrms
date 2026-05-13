import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateReference } from "@/lib/reference";
import { getDepartmentCode } from "@/lib/departments";
import { encryptFile } from "@/lib/encryption";
import { enqueueOcr } from "@/lib/queue";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

/**
 * POST /api/office/ingest
 *
 * Multipart upload endpoint used by the Office and Outlook add-in task panes
 * to persist documents (and email bodies + attachments) into the EDRMS.
 *
 * Form fields:
 *   - host          word | excel | powerpoint | outlook   (required)
 *   - title         human-readable title                  (required)
 *   - department    department name (optional, defaults to session user's)
 *   - documentType  e.g. MEMO, REPORT, EMAIL              (optional, defaults derived from host)
 *   - tags          comma-separated tag list              (optional)
 *   - file          one or more files                     (required, ≥1)
 *
 * The first file becomes the "primary" file used for the auto-created
 * Document + initial DocumentVersion. Additional files are stored as extra
 * DocumentFile rows on the same document (used for Outlook attachments).
 *
 * Auth: session-cookie based (next-auth). No API-key path here — the add-in
 * runs inside the user's browser and shares cookies with the EDRMS app.
 */

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB per file

const ALLOWED_HOSTS = new Set(["word", "excel", "powerpoint", "outlook"]);

/**
 * Map an Office host to a sensible default documentType when the client
 * doesn't supply one explicitly.
 */
function defaultDocTypeForHost(host: string): string {
  if (host === "outlook") return "EMAIL";
  return "DOCUMENT";
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
    }

    const host = (formData.get("host") as string | null)?.toLowerCase() ?? "";
    if (!ALLOWED_HOSTS.has(host)) {
      return NextResponse.json(
        { error: `host must be one of: ${[...ALLOWED_HOSTS].join(", ")}` },
        { status: 400 }
      );
    }

    const title = (formData.get("title") as string | null)?.trim() ?? "";
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const department =
      (formData.get("department") as string | null)?.trim() ||
      session.user.department ||
      "GENERAL";
    const documentType =
      (formData.get("documentType") as string | null)?.trim() ||
      defaultDocTypeForHost(host);
    const tagsRaw = (formData.get("tags") as string | null) ?? "";
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Collect every "file" part. FormData.getAll preserves order.
    const fileEntries = formData.getAll("file").filter((v): v is File => v instanceof File);
    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
    }
    for (const f of fileEntries) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${f.name}" exceeds the 2 GB limit` },
          { status: 400 }
        );
      }
    }

    // Generate a single reference number for the whole submission.
    const deptAbbr = getDepartmentCode(department);
    const referenceNumber = await generateReference("DOC", deptAbbr);

    // Read every file into memory; compute hashes; write to disk.
    interface PreparedFile {
      file: File;
      buffer: Buffer;
      hash: string;
      storagePath: string;
      diskPath: string;
    }

    const uploadDir = path.join(process.cwd(), "uploads", "edrms", referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });

    const prepared: PreparedFile[] = [];
    const seenNames = new Set<string>();
    for (const f of fileEntries) {
      // Avoid filename collisions if Outlook sent two attachments with the
      // same name.
      let safeName = f.name && f.name.trim().length > 0 ? f.name : "file";
      if (seenNames.has(safeName)) {
        const ext = path.extname(safeName);
        const stem = path.basename(safeName, ext);
        let i = 2;
        while (seenNames.has(`${stem} (${i})${ext}`)) i++;
        safeName = `${stem} (${i})${ext}`;
      }
      seenNames.add(safeName);

      const buffer = Buffer.from(await f.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const diskPath = path.join(uploadDir, safeName);
      await fs.writeFile(diskPath, buffer);
      prepared.push({
        file: new File([buffer], safeName, { type: f.type }),
        buffer,
        hash,
        storagePath: `uploads/edrms/${referenceNumber}/${safeName}`,
        diskPath,
      });
    }

    // Encrypt at rest (best-effort — if ENCRYPTION_KEY isn't set, we skip).
    const encryptedMeta = await Promise.all(
      prepared.map(async (p) => {
        try {
          const enc = await encryptFile(p.diskPath);
          return { iv: enc.iv as string | null, tag: enc.tag as string | null };
        } catch {
          return { iv: null, tag: null };
        }
      })
    );

    // Duplicate check on the *primary* file (first one).
    const primary = prepared[0];
    const duplicate = await db.document.findFirst({
      where: { contentHash: primary.hash },
      select: { id: true, referenceNumber: true, title: true },
    });
    if (duplicate) {
      // Clean up just-written files to avoid orphaning bytes on disk.
      await Promise.all(prepared.map((p) => fs.unlink(p.diskPath).catch(() => null)));
      await fs.rmdir(uploadDir).catch(() => null);
      return NextResponse.json(
        {
          error: "A document with identical content already exists",
          duplicate,
        },
        { status: 409 }
      );
    }

    // Build everything in a single transaction.
    const metadata: Record<string, unknown> = { officeHost: host };
    const document = await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          referenceNumber,
          title,
          description: "",
          documentType,
          department,
          createdById: session.user.id,
          sourceSystem: host === "outlook" ? "OUTLOOK_ADDIN" : "OFFICE_ADDIN",
          contentHash: primary.hash,
          metadata: metadata as Record<string, never>,
          files: {
            create: prepared.map((p, idx) => ({
              storagePath: p.storagePath,
              fileName: p.file.name,
              mimeType: p.file.type || "application/octet-stream",
              sizeBytes: BigInt(p.buffer.length),
              ocrStatus: "PENDING",
              encryptionIv: encryptedMeta[idx].iv,
              encryptionTag: encryptedMeta[idx].tag,
            })),
          },
          versions: {
            create: {
              versionNum: 1,
              storagePath: primary.storagePath,
              fileName: primary.file.name,
              mimeType: primary.file.type || "application/octet-stream",
              sizeBytes: BigInt(primary.buffer.length),
              changeNote: `Initial upload from ${host} add-in`,
              createdById: session.user.id,
            },
          },
          ...(tags.length > 0
            ? {
                tags: {
                  createMany: {
                    data: tags.map((tag) => ({ tag })),
                  },
                },
              }
            : {}),
        },
        include: { files: { select: { id: true } } },
      });
      return doc;
    });

    // Hand off OCR for every file (best-effort).
    for (const f of document.files) {
      await enqueueOcr(f.id, { priority: 0 }).catch(() => null);
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.created",
      resourceType: "Document",
      resourceId: document.id,
      metadata: {
        referenceNumber,
        title,
        documentType,
        source: host === "outlook" ? "OUTLOOK_ADDIN" : "OFFICE_ADDIN",
        host,
        fileCount: prepared.length,
      },
    });

    logger.info("Office add-in ingest succeeded", {
      userId: session.user.id,
      action: "office.ingest",
      route: "/api/office/ingest",
      method: "POST",
    });

    return NextResponse.json(
      { documentId: document.id, referenceNumber },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Office add-in ingest failed", error, {
      route: "/api/office/ingest",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
