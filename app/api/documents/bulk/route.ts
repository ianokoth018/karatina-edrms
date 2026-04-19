import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// POST /api/documents/bulk — perform bulk operations on documents
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, documentIds, data } = (await req.json()) as {
      action: string;
      documentIds: string[];
      data?: Record<string, unknown>;
    };

    if (!action || !documentIds?.length) {
      return NextResponse.json(
        { error: "action and documentIds are required" },
        { status: 400 }
      );
    }

    if (documentIds.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 documents per bulk operation" },
        { status: 400 }
      );
    }

    const validActions = ["classify", "tag", "transfer", "archive", "delete"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify documents exist
    const docs = await db.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, status: true },
    });

    if (docs.length !== documentIds.length) {
      return NextResponse.json(
        { error: `Found ${docs.length} of ${documentIds.length} documents` },
        { status: 404 }
      );
    }

    let affected = 0;

    switch (action) {
      case "classify": {
        const nodeId = data?.classificationNodeId as string;
        if (!nodeId) {
          return NextResponse.json({ error: "classificationNodeId is required" }, { status: 400 });
        }
        const result = await db.document.updateMany({
          where: { id: { in: documentIds } },
          data: { classificationNodeId: nodeId },
        });
        affected = result.count;
        break;
      }

      case "tag": {
        const tags = data?.tags as string[];
        if (!tags?.length) {
          return NextResponse.json({ error: "tags array is required" }, { status: 400 });
        }
        // Add tags to each document (skip duplicates)
        for (const docId of documentIds) {
          for (const tagName of tags) {
            const trimmed = tagName.trim();
            if (!trimmed) continue;
            await db.documentTag.upsert({
              where: { documentId_tag: { documentId: docId, tag: trimmed } },
              create: { documentId: docId, tag: trimmed },
              update: {},
            });
          }
        }
        affected = documentIds.length;
        break;
      }

      case "transfer": {
        const department = data?.department as string;
        if (!department) {
          return NextResponse.json({ error: "department is required" }, { status: 400 });
        }
        const result = await db.document.updateMany({
          where: { id: { in: documentIds } },
          data: { department },
        });
        affected = result.count;
        break;
      }

      case "archive": {
        const result = await db.document.updateMany({
          where: {
            id: { in: documentIds },
            status: { not: "DISPOSED" },
          },
          data: { status: "ARCHIVED" },
        });
        affected = result.count;
        break;
      }

      case "delete": {
        // Only allow deleting DRAFT documents
        const drafts = docs.filter((d) => d.status === "DRAFT");
        if (drafts.length === 0) {
          return NextResponse.json(
            { error: "Only DRAFT documents can be deleted" },
            { status: 400 }
          );
        }
        const draftIds = drafts.map((d) => d.id);
        const result = await db.document.deleteMany({
          where: { id: { in: draftIds } },
        });
        affected = result.count;
        break;
      }
    }

    // Audit each document
    for (const docId of documentIds) {
      await writeAudit({
        userId: session.user.id,
        action: `document.bulk_${action}`,
        resourceType: "Document",
        resourceId: docId,
        metadata: { bulkAction: action, data },
      });
    }

    logger.info("Bulk document operation", {
      userId: session.user.id,
      action: `bulk_${action}`,
      affected,
      documentCount: documentIds.length,
    });

    return NextResponse.json({ success: true, affected });
  } catch (error) {
    logger.error("Failed bulk document operation", error, {
      route: "/api/documents/bulk",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
