import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

interface Change {
  field: string;
  before: string | null;
  after: string | null;
}

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
// GET /api/documents/[id]/versions/compare?v1=...&v2=...
// Compare two versions of a document
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
    const { searchParams } = new URL(req.url);
    const v1Id = searchParams.get("v1");
    const v2Id = searchParams.get("v2");

    if (!v1Id || !v2Id) {
      return NextResponse.json(
        { error: "Both v1 and v2 query parameters are required" },
        { status: 400 }
      );
    }

    if (v1Id === v2Id) {
      return NextResponse.json(
        { error: "Cannot compare a version with itself" },
        { status: 400 }
      );
    }

    // Verify document exists
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, title: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Fetch both versions
    const [version1, version2] = await Promise.all([
      db.documentVersion.findFirst({
        where: { id: v1Id, documentId: id },
      }),
      db.documentVersion.findFirst({
        where: { id: v2Id, documentId: id },
      }),
    ]);

    if (!version1) {
      return NextResponse.json(
        { error: `Version ${v1Id} not found` },
        { status: 404 }
      );
    }

    if (!version2) {
      return NextResponse.json(
        { error: `Version ${v2Id} not found` },
        { status: 404 }
      );
    }

    // Build the list of changes between versions
    const changes: Change[] = [];

    // Compare version numbers
    if (version1.versionNum !== version2.versionNum) {
      changes.push({
        field: "Version Number",
        before: `v${version1.versionNum}`,
        after: `v${version2.versionNum}`,
      });
    }

    // Compare change notes
    if (version1.changeNote !== version2.changeNote) {
      changes.push({
        field: "Change Note",
        before: version1.changeNote,
        after: version2.changeNote,
      });
    }

    // Compare file sizes
    if (version1.sizeBytes !== version2.sizeBytes) {
      changes.push({
        field: "File Size",
        before: formatFileSize(version1.sizeBytes),
        after: formatFileSize(version2.sizeBytes),
      });
    }

    // Compare storage paths (file name changes)
    const fileName1 = version1.storagePath.split("/").pop() ?? version1.storagePath;
    const fileName2 = version2.storagePath.split("/").pop() ?? version2.storagePath;
    if (fileName1 !== fileName2) {
      changes.push({
        field: "File Name",
        before: fileName1,
        after: fileName2,
      });
    }

    // Compare created by
    if (version1.createdById !== version2.createdById) {
      // Fetch user names for display
      const [user1, user2] = await Promise.all([
        db.user.findUnique({
          where: { id: version1.createdById },
          select: { displayName: true },
        }),
        db.user.findUnique({
          where: { id: version2.createdById },
          select: { displayName: true },
        }),
      ]);
      changes.push({
        field: "Created By",
        before: user1?.displayName ?? version1.createdById,
        after: user2?.displayName ?? version2.createdById,
      });
    }

    // Compare dates
    if (version1.createdAt.toISOString() !== version2.createdAt.toISOString()) {
      changes.push({
        field: "Created At",
        before: version1.createdAt.toISOString(),
        after: version2.createdAt.toISOString(),
      });
    }

    return NextResponse.json(
      serialiseBigInt({
        version1: {
          id: version1.id,
          versionNum: version1.versionNum,
          changeNote: version1.changeNote,
          sizeBytes: version1.sizeBytes,
          storagePath: version1.storagePath,
          createdById: version1.createdById,
          createdAt: version1.createdAt.toISOString(),
        },
        version2: {
          id: version2.id,
          versionNum: version2.versionNum,
          changeNote: version2.changeNote,
          sizeBytes: version2.sizeBytes,
          storagePath: version2.storagePath,
          createdById: version2.createdById,
          createdAt: version2.createdAt.toISOString(),
        },
        changes,
      })
    );
  } catch (error) {
    logger.error("Version comparison failed", error, {
      route: "/api/documents/[id]/versions/compare",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function formatFileSize(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
