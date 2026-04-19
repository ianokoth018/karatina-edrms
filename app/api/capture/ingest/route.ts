import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptFile } from "@/lib/encryption";
import { enqueueOcr } from "@/lib/queue";
import { fireTriggers } from "@/lib/capture-notifications";
import { validateMetadata } from "@/lib/capture-validator";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "edrms");

async function verifyApiKey(req: NextRequest): Promise<boolean> {
  const raw = req.headers.get("x-api-key");
  if (!raw) return false;

  const activeKeys = await db.apiKey.findMany({
    where: { revokedAt: null, scope: { in: ["capture", "integration"] } },
    select: { id: true, hashedKey: true },
  });

  for (const k of activeKeys) {
    const match = await bcrypt.compare(raw, k.hashedKey);
    if (match) {
      // Update lastUsedAt asynchronously
      db.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!(await verifyApiKey(req))) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const profileId = formData.get("profileId") as string | null;
  const metadataRaw = formData.get("metadata") as string | null;

  if (!file || !profileId) {
    return NextResponse.json({ error: "file and profileId are required" }, { status: 400 });
  }

  const profile = await db.captureProfile.findUnique({ where: { id: profileId, isActive: true } });
  if (!profile) return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });

  let metadata: Record<string, string> = {};
  if (metadataRaw) {
    try { metadata = JSON.parse(metadataRaw); } catch { /* ignore */ }
  }

  // Validation
  if (profile.validationRules && Object.keys(profile.validationRules as object).length > 0) {
    const result = await validateMetadata(profile.validationRules, metadata, db as never);
    if (!result.valid) {
      await db.captureException.create({
        data: {
          profileId,
          filePath: `[API] ${file.name}`,
          extractedMetadata: metadata,
          errors: result.errors as never,
          status: "PENDING",
        },
      });
      return NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: 422 });
    }
  }

  // Save file bytes
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  // Dedup check
  const existing = await db.captureLog.findFirst({ where: { fileHash, status: "CAPTURED" } });
  if (existing && profile.duplicateAction === "SKIP") {
    return NextResponse.json({ status: "duplicate", duplicateOf: existing.documentId }, { status: 200 });
  }

  // Write to uploads
  const refPrefix = `API-${Date.now()}`;
  const uploadDir = path.join(UPLOADS_DIR, refPrefix);
  await fs.mkdir(uploadDir, { recursive: true });
  const destPath = path.join(uploadDir, file.name);
  await fs.writeFile(destPath, bytes);

  let encryptionIv: string | null = null;
  let encryptionTag: string | null = null;
  try {
    const enc = await encryptFile(destPath);
    encryptionIv = enc.iv; encryptionTag = enc.tag;
  } catch { /* encryption key not configured */ }

  const storagePath = `uploads/edrms/${refPrefix}/${file.name}`;
  const department = profile.department || "GENERAL";

  const { document: doc, captureLog } = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        referenceNumber: refPrefix,
        title: metadata.title || `API Capture: ${file.name}`,
        documentType: metadata.documentType || "CAPTURED",
        status: "ACTIVE",
        department,
        classificationNodeId: profile.classificationNodeId || null,
        createdById: profile.createdById,
        sourceSystem: "API_CAPTURE",
        contentHash: fileHash,
        metadata: { profileId, apiCapture: true, ...metadata },
        files: {
          create: {
            storagePath, fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: BigInt(bytes.length),
            ocrStatus: "PENDING",
            encryptionIv, encryptionTag,
          },
        },
      },
    });
    const log = await tx.captureLog.create({
      data: {
        profileId, fileName: file.name, filePath: storagePath,
        fileSize: BigInt(bytes.length), fileHash, status: "CAPTURED",
        documentId: doc.id, metadata, processedAt: new Date(),
      },
    });
    return { document: doc, captureLog: log };
  });

  // OCR + triggers
  const fileRecord = await db.documentFile.findFirst({ where: { documentId: doc.id }, select: { id: true } });
  if (fileRecord) await enqueueOcr(fileRecord.id, { priority: profile.priority ?? 0 });
  await fireTriggers(db as never, {
    profileId, documentType: doc.documentType, registrationNumber: metadata.registrationNumber ?? null,
    documentId: doc.id, fileId: fileRecord?.id ?? null, fileName: file.name, metadata,
  }).catch(() => null);

  return NextResponse.json({ documentId: doc.id, logId: captureLog.id, status: "captured" }, { status: 201 });
}
