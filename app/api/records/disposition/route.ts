import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/disposition — list documents eligible for disposition
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
    );
    const statusFilter = searchParams.get("status"); // "PENDING_DISPOSAL" | "ELIGIBLE"
    const department = searchParams.get("department");

    const now = new Date();

    // Base condition: never include disposed documents, always exclude legal holds
    const baseConditions = {
      isOnLegalHold: false,
    };

    // Build the OR clauses based on the status filter
    let whereClause: Record<string, unknown>;

    if (statusFilter === "PENDING_DISPOSAL") {
      // Only documents already flagged for disposal
      whereClause = {
        ...baseConditions,
        status: "PENDING_DISPOSAL" as const,
      };
    } else if (statusFilter === "ELIGIBLE") {
      // Only documents whose retention has expired but not yet flagged/disposed
      whereClause = {
        ...baseConditions,
        retentionExpiresAt: { lte: now },
        status: { notIn: ["DISPOSED", "PENDING_DISPOSAL"] },
      };
    } else {
      // Default: both eligible and pending disposal
      whereClause = {
        ...baseConditions,
        OR: [
          {
            retentionExpiresAt: { lte: now },
            status: { notIn: ["DISPOSED", "PENDING_DISPOSAL"] },
          },
          {
            status: "PENDING_DISPOSAL" as const,
          },
        ],
      };
    }

    // Optional department filter
    if (department) {
      whereClause.department = department;
    }

    const [documents, total] = await Promise.all([
      db.document.findMany({
        where: whereClause,
        include: {
          createdBy: {
            select: { id: true, name: true, displayName: true },
          },
          classificationNode: {
            select: {
              id: true,
              code: true,
              title: true,
              level: true,
              retentionSchedules: {
                select: {
                  id: true,
                  activeYears: true,
                  inactiveYears: true,
                  totalYears: true,
                  disposalAction: true,
                  legalBasis: true,
                },
              },
            },
          },
        },
        orderBy: { retentionExpiresAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.document.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limit);

    // Map documents to include the recommended disposal action from the retention schedule
    const results = documents.map((doc) => {
      const schedule =
        doc.classificationNode?.retentionSchedules?.[0] ?? null;

      return {
        id: doc.id,
        referenceNumber: doc.referenceNumber,
        title: doc.title,
        description: doc.description,
        documentType: doc.documentType,
        status: doc.status,
        department: doc.department,
        retentionExpiresAt: doc.retentionExpiresAt,
        createdAt: doc.createdAt,
        createdBy: doc.createdBy,
        classificationNode: doc.classificationNode
          ? {
              id: doc.classificationNode.id,
              code: doc.classificationNode.code,
              title: doc.classificationNode.title,
              level: doc.classificationNode.level,
            }
          : null,
        retentionSchedule: schedule
          ? {
              id: schedule.id,
              activeYears: schedule.activeYears,
              inactiveYears: schedule.inactiveYears,
              totalYears: schedule.totalYears,
              disposalAction: schedule.disposalAction,
              legalBasis: schedule.legalBasis,
            }
          : null,
        recommendedAction: schedule?.disposalAction ?? null,
      };
    });

    return NextResponse.json({
      documents: results,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error("Failed to list disposition-eligible documents", error, {
      route: "/api/records/disposition",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/disposition — execute disposition actions on documents
// ---------------------------------------------------------------------------

interface DispositionBody {
  documentIds: string[];
  action: "DESTROY" | "ARCHIVE_PERMANENT" | "REVIEW";
  approvedBy: string;
  notes?: string;
}

const VALID_ACTIONS = new Set(["DESTROY", "ARCHIVE_PERMANENT", "REVIEW"]);

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: DispositionBody = await req.json();

    // --- Validate request body ---
    if (
      !body.documentIds ||
      !Array.isArray(body.documentIds) ||
      body.documentIds.length === 0
    ) {
      return NextResponse.json(
        { error: "documentIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (!body.action || !VALID_ACTIONS.has(body.action)) {
      return NextResponse.json(
        {
          error:
            "action must be one of: DESTROY, ARCHIVE_PERMANENT, REVIEW",
        },
        { status: 400 }
      );
    }

    if (!body.approvedBy) {
      return NextResponse.json(
        { error: "approvedBy is required" },
        { status: 400 }
      );
    }

    // Fetch all requested documents
    const documents = await db.document.findMany({
      where: { id: { in: body.documentIds } },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        status: true,
        isOnLegalHold: true,
      },
    });

    const foundIds = new Set(documents.map((d) => d.id));

    // Identify documents on legal hold -- these must be skipped
    const skippedDocs = documents.filter((d) => d.isOnLegalHold);
    const skippedIds = skippedDocs.map((d) => d.id);
    const skippedIdSet = new Set(skippedIds);

    // Documents that can be processed
    const processable = documents.filter(
      (d) => !d.isOnLegalHold && foundIds.has(d.id)
    );

    // Determine the target status based on the action
    let targetStatus: "DISPOSED" | "ARCHIVED" | "PENDING_DISPOSAL";
    switch (body.action) {
      case "DESTROY":
        targetStatus = "DISPOSED";
        break;
      case "ARCHIVE_PERMANENT":
        targetStatus = "ARCHIVED";
        break;
      case "REVIEW":
        targetStatus = "PENDING_DISPOSAL";
        break;
    }

    // Execute updates in a transaction
    await db.$transaction(async (tx) => {
      for (const doc of processable) {
        await tx.document.update({
          where: { id: doc.id },
          data: { status: targetStatus },
        });
      }
    });

    // Write audit logs for each processed document (outside transaction to
    // avoid holding the connection open longer than necessary)
    const auditPromises = processable.map((doc) =>
      writeAudit({
        userId: session.user.id,
        action: `disposition.${body.action.toLowerCase()}`,
        resourceType: "Document",
        resourceId: doc.id,
        metadata: {
          referenceNumber: doc.referenceNumber,
          title: doc.title,
          previousStatus: doc.status,
          newStatus: targetStatus,
          approvedBy: body.approvedBy,
          notes: body.notes ?? null,
        },
      })
    );

    // Also audit skipped documents so there is a record of the attempt
    const skippedAuditPromises = skippedDocs.map((doc) =>
      writeAudit({
        userId: session.user.id,
        action: "disposition.skipped_legal_hold",
        resourceType: "Document",
        resourceId: doc.id,
        metadata: {
          referenceNumber: doc.referenceNumber,
          title: doc.title,
          attemptedAction: body.action,
          reason: "Document is on legal hold",
        },
      })
    );

    await Promise.all([...auditPromises, ...skippedAuditPromises]);

    // Report IDs that were in the request but not found in the database
    const notFoundIds = body.documentIds.filter(
      (id) => !foundIds.has(id) && !skippedIdSet.has(id)
    );

    logger.info("Disposition action executed", {
      userId: session.user.id,
      action: `disposition.${body.action.toLowerCase()}`,
      route: "/api/records/disposition",
      method: "POST",
    });

    return NextResponse.json({
      processed: processable.length,
      skipped: skippedDocs.length,
      skippedIds,
      ...(notFoundIds.length > 0 ? { notFoundIds } : {}),
    });
  } catch (error) {
    logger.error("Failed to execute disposition action", error, {
      route: "/api/records/disposition",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
