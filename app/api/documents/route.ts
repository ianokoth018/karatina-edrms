import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateReference } from "@/lib/reference";
import { logger } from "@/lib/logger";
import crypto from "crypto";
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

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Custom JSON serialiser that converts BigInt values to strings so that
 * `JSON.stringify` does not throw.
 */
function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
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
// GET /api/documents — list documents with filters & pagination
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const status = searchParams.get("status");
    const department = searchParams.get("department");
    const documentType = searchParams.get("type");
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Build where clause
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    } else {
      // Exclude disposed documents by default
      where.status = { not: "DISPOSED" };
    }

    if (department) {
      where.department = department;
    }

    if (documentType) {
      where.documentType = documentType;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      where.createdAt = createdAt;
    }

    const [documents, total] = await Promise.all([
      db.document.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, displayName: true } },
          files: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
          _count: { select: { files: true, versions: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.document.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json(
      serialiseBigInt({
        documents,
        pagination: { page, limit, total, totalPages },
      })
    );
  } catch (error) {
    logger.error("Failed to list documents", error, {
      route: "/api/documents",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/documents — create a new document with file upload
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();

    // Extract fields
    const title = formData.get("title") as string | null;
    const documentType = formData.get("documentType") as string | null;
    const department = (formData.get("department") as string) || session.user.department || "GENERAL";
    const description = (formData.get("description") as string) || "";
    const classificationNodeId = (formData.get("classificationNodeId") as string) || null;
    const tagsRaw = (formData.get("tags") as string) || "";
    const isVitalRecord = formData.get("isVitalRecord") === "true";
    const metadataRaw = formData.get("metadata") as string | null;
    const file = formData.get("file") as File | null;

    // Validate required fields
    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!documentType) {
      return NextResponse.json({ error: "Document type is required" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type "${file.type}" is not allowed. Accepted: PDF, DOCX, XLSX, PPTX, JPG, PNG, TIFF` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds the 50 MB limit` },
        { status: 400 }
      );
    }

    // Parse optional metadata JSON
    let metadata: Record<string, unknown> = {};
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        return NextResponse.json({ error: "Invalid metadata JSON" }, { status: 400 });
      }
    }

    // Parse tags
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Derive a short department abbreviation for the reference number
    const deptAbbr = department.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "GEN";
    const referenceNumber = await generateReference("DOC", deptAbbr);

    // Read file buffer and compute content hash
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Check for duplicate by content hash
    const duplicate = await db.document.findFirst({
      where: { contentHash },
      select: { id: true, referenceNumber: true, title: true },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error: "A document with identical content already exists",
          duplicate: { id: duplicate.id, referenceNumber: duplicate.referenceNumber, title: duplicate.title },
        },
        { status: 409 }
      );
    }

    // Save file to disk
    const uploadDir = path.join(process.cwd(), "uploads", "edrms", referenceNumber);
    await fs.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, file.name);
    await fs.writeFile(filePath, fileBuffer);
    const storagePath = `uploads/edrms/${referenceNumber}/${file.name}`;

    // Create Document + DocumentFile + Tags in a transaction
    const document = await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          referenceNumber,
          title: title.trim(),
          description: description.trim(),
          documentType,
          department,
          classificationNodeId: classificationNodeId || null,
          createdById: session.user.id,
          isVitalRecord,
          contentHash,
          metadata: metadata as Record<string, never>,
          files: {
            create: {
              storagePath,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: BigInt(file.size),
              ocrStatus: "PENDING",
            },
          },
          versions: {
            create: {
              versionNum: 1,
              storagePath,
              sizeBytes: BigInt(file.size),
              changeNote: "Initial upload",
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
        include: {
          files: true,
          versions: true,
          tags: true,
          createdBy: { select: { id: true, name: true, displayName: true } },
        },
      });

      return doc;
    });

    // Audit log (non-blocking)
    await writeAudit({
      userId: session.user.id,
      action: "document.created",
      resourceType: "Document",
      resourceId: document.id,
      metadata: { referenceNumber, title: title.trim(), documentType, fileName: file.name },
    });

    logger.info("Document created", {
      userId: session.user.id,
      action: "document.created",
      route: "/api/documents",
      method: "POST",
    });

    return NextResponse.json(serialiseBigInt(document), { status: 201 });
  } catch (error) {
    logger.error("Failed to create document", error, {
      route: "/api/documents",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
