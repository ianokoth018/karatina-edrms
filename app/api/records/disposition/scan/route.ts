import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/records/disposition/scan — scan all documents and flag those
// whose retention has expired (set retentionExpiresAt)
// ---------------------------------------------------------------------------
export async function POST(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Find documents that:
    // 1. Have a classification node assigned
    // 2. Have NOT yet had retentionExpiresAt set
    // 3. Are not already disposed
    // We join with RetentionSchedule to get totalYears, then check if
    // (createdAt + totalYears) <= now.
    //
    // Prisma does not support date arithmetic in where clauses, so we fetch
    // candidates and filter in application code.
    const candidates = await db.document.findMany({
      where: {
        classificationNodeId: { not: null },
        retentionExpiresAt: null,
        status: { notIn: ["DISPOSED"] },
      },
      select: {
        id: true,
        referenceNumber: true,
        createdAt: true,
        classificationNodeId: true,
        classificationNode: {
          select: {
            retentionSchedules: {
              select: {
                totalYears: true,
              },
            },
          },
        },
      },
    });

    // Determine which documents have exceeded their retention period
    const expiredDocuments: Array<{
      id: string;
      referenceNumber: string;
      retentionExpiresAt: Date;
    }> = [];

    for (const doc of candidates) {
      const schedules = doc.classificationNode?.retentionSchedules ?? [];
      if (schedules.length === 0) continue;

      // Use the first retention schedule for this classification node
      const totalYears = schedules[0].totalYears;

      // Calculate the retention expiry date: createdAt + totalYears
      const expiryDate = new Date(doc.createdAt);
      expiryDate.setFullYear(expiryDate.getFullYear() + totalYears);

      if (expiryDate <= now) {
        expiredDocuments.push({
          id: doc.id,
          referenceNumber: doc.referenceNumber,
          retentionExpiresAt: expiryDate,
        });
      }
    }

    // Batch update the expired documents with their calculated retentionExpiresAt
    if (expiredDocuments.length > 0) {
      await db.$transaction(
        expiredDocuments.map((doc) =>
          db.document.update({
            where: { id: doc.id },
            data: { retentionExpiresAt: doc.retentionExpiresAt },
          })
        )
      );
    }

    // Audit the scan operation
    await writeAudit({
      userId: session.user.id,
      action: "disposition.scan",
      resourceType: "Document",
      metadata: {
        candidatesScanned: candidates.length,
        newlyFlagged: expiredDocuments.length,
        flaggedDocumentIds: expiredDocuments.map((d) => d.id),
      },
    });

    logger.info("Disposition scan completed", {
      userId: session.user.id,
      action: "disposition.scan",
      route: "/api/records/disposition/scan",
      method: "POST",
    });

    return NextResponse.json({
      scanned: candidates.length,
      flagged: expiredDocuments.length,
      flaggedDocuments: expiredDocuments.map((d) => ({
        id: d.id,
        referenceNumber: d.referenceNumber,
        retentionExpiresAt: d.retentionExpiresAt,
      })),
    });
  } catch (error) {
    logger.error("Failed to run disposition scan", error, {
      route: "/api/records/disposition/scan",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
