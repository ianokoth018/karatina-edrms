import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

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
// GET /api/records/casefolders/[id] — casefolder definition + paginated docs
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
    const { searchParams } = req.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
    );
    const search = searchParams.get("search")?.trim() || null;
    const view = searchParams.get("view") || "documents"; // "documents" | "folders"
    const folderKey = searchParams.get("folderKey") || null; // filter to a specific folder

    // Fetch the form template (casefolder definition)
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Casefolder not found" },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields = (template.fields ?? []) as any[];

    // Find aggregation key fields
    const aggregationFields = fields.filter(
      (f: { isAggregationKey?: boolean }) => f.isAggregationKey
    );
    const hasAggregation = aggregationFields.length > 0;

    // Build where clause for documents in this casefolder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      metadata: {
        path: ["formTemplateId"],
        equals: id,
      },
      status: { not: "DISPOSED" },
    };

    // If viewing a specific folder, filter by aggregation key values
    // folderKey format: "value1||value2" for composite keys
    if (folderKey && hasAggregation) {
      const keyValues = folderKey.split("||");
      const conditions = [
        { metadata: { path: ["formTemplateId"], equals: id } },
      ];
      for (let i = 0; i < aggregationFields.length && i < keyValues.length; i++) {
        const aggFieldName = aggregationFields[i].name as string;
        conditions.push({
          metadata: { path: [aggFieldName], equals: keyValues[i] },
        });
      }
      where.AND = conditions;
      delete where.metadata;
    }

    // Add search filter
    if (search) {
      const searchCondition = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { referenceNumber: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      };
      if (where.AND) {
        where.AND.push(searchCondition);
      } else {
        Object.assign(where, searchCondition);
      }
    }

    // ---------- Folders view (aggregated) ----------
    if (view === "folders" && hasAggregation) {
      const aggFieldNames = aggregationFields.map((f: { name: string }) => f.name);
      const aggFieldLabels = aggregationFields.map((f: { label: string }) => f.label);

      // Fetch ALL documents in this casefolder (no pagination for grouping)
      const allDocs = await db.document.findMany({
        where: {
          metadata: { path: ["formTemplateId"], equals: id },
          status: { not: "DISPOSED" },
        },
        select: {
          id: true,
          metadata: true,
          createdAt: true,
          files: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Group by composite aggregation key (multiple fields joined by ||)
      const folderMap = new Map<
        string,
        {
          key: string;
          keyParts: Record<string, string>;
          label: string;
          documentCount: number;
          fileCount: number;
          latestDate: Date;
          metadata: Record<string, unknown>;
        }
      >();

      for (const doc of allDocs) {
        const meta = (doc.metadata ?? {}) as Record<string, unknown>;

        // Build composite key (multi-strategy: direct → label → camelCase)
        const metaLabels = ((meta._fieldLabels ?? {}) as Record<string, string>);
        const keyParts: Record<string, string> = {};
        const keyValues: string[] = [];
        for (let ai = 0; ai < aggFieldNames.length; ai++) {
          const aggName = aggFieldNames[ai];
          const aggLabel = aggFieldLabels[ai];
          let val = meta[aggName];
          if (val === undefined && aggLabel && metaLabels[aggLabel] !== undefined) val = metaLabels[aggLabel];
          if (val === undefined) {
            const camel = aggName.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
            val = meta[camel];
          }
          const strVal = String(val ?? "Unknown");
          keyParts[aggName] = strVal;
          keyValues.push(strVal);
        }
        const compositeKey = keyValues.join("||");

        if (!folderMap.has(compositeKey)) {
          // Build display label from key parts
          const labelParts = aggFieldLabels.map(
            (label: string, i: number) => `${label}: ${keyValues[i]}`
          );

          // Collect casefolder-level fields for display (multi-strategy matching)
          const rawLabels = ((meta._fieldLabels ?? {}) as Record<string, string>);
          const displayMeta: Record<string, unknown> = {};
          for (const f of fields) {
            if (f.fieldLevel === "document" || !f.name) continue;
            const fname = f.name as string;
            const flabel = f.label as string;
            // Direct → label → camelCase
            let val = meta[fname];
            if (val === undefined && flabel && rawLabels[flabel] !== undefined) val = rawLabels[flabel];
            if (val === undefined) {
              const camel = fname.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
              val = meta[camel];
            }
            if (val !== undefined) displayMeta[fname] = val;
          }

          folderMap.set(compositeKey, {
            key: compositeKey,
            keyParts,
            label: labelParts.join(" | "),
            documentCount: 0,
            fileCount: 0,
            latestDate: doc.createdAt,
            metadata: displayMeta,
          });
        }

        const folder = folderMap.get(compositeKey)!;
        folder.documentCount++;
        folder.fileCount += doc.files.length;
        if (doc.createdAt > folder.latestDate) {
          folder.latestDate = doc.createdAt;
        }
      }

      // Convert to array and apply search filter
      let folders = Array.from(folderMap.values());
      if (search) {
        const q = search.toLowerCase();
        folders = folders.filter(
          (f) =>
            f.key.toLowerCase().includes(q) ||
            f.label.toLowerCase().includes(q) ||
            Object.values(f.keyParts).some((v) => v.toLowerCase().includes(q)) ||
            Object.values(f.metadata).some(
              (v) => String(v).toLowerCase().includes(q)
            )
        );
      }

      // Sort by latest date descending
      folders.sort((a, b) => b.latestDate.getTime() - a.latestDate.getTime());

      // Paginate
      const totalFolders = folders.length;
      const paginatedFolders = folders.slice((page - 1) * limit, page * limit);

      return NextResponse.json(
        serialiseBigInt({
          casefolder: {
            id: template.id,
            name: template.name,
            description: template.description,
            fields: template.fields,
          },
          view: "folders",
          aggregationFields: aggFieldNames.map((name: string, i: number) => ({
            name,
            label: aggFieldLabels[i],
          })),
          folders: paginatedFolders,
          pagination: { page, limit, total: totalFolders, totalPages: Math.ceil(totalFolders / limit) },
        })
      );
    }

    // ---------- Documents view (flat or filtered to a folder) ----------
    const [documents, total] = await Promise.all([
      db.document.findMany({
        where,
        include: {
          createdBy: {
            select: { id: true, name: true, displayName: true },
          },
          files: {
            select: { id: true, fileName: true, mimeType: true },
          },
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
        casefolder: {
          id: template.id,
          name: template.name,
          description: template.description,
          fields: template.fields,
        },
        view: "documents",
        folderKey: folderKey || null,
        hasAggregation,
        documents: documents.map((doc) => ({
          id: doc.id,
          referenceNumber: doc.referenceNumber,
          title: doc.title,
          status: doc.status,
          department: doc.department,
          metadata: doc.metadata,
          createdAt: doc.createdAt,
          files: doc.files,
          createdBy: {
            name: doc.createdBy.name,
            displayName: doc.createdBy.displayName,
          },
        })),
        pagination: { page, limit, total, totalPages },
      })
    );
  } catch (error) {
    logger.error("Failed to get casefolder documents", error, {
      route: "/api/records/casefolders/[id]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/casefolders/[id] — file a new document into this casefolder
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

    // Verify the form template exists and is active
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, fields: true, isActive: true },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Casefolder not found" },
        { status: 404 }
      );
    }

    if (!template.isActive) {
      return NextResponse.json(
        { error: "This casefolder is no longer active" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { title, department, description, fieldValues, classificationNodeId } =
      body as {
        title?: string;
        department?: string;
        description?: string;
        fieldValues?: Record<string, unknown>;
        classificationNodeId?: string;
      };

    // Validate required fields
    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!department?.trim()) {
      return NextResponse.json(
        { error: "Department is required" },
        { status: 400 }
      );
    }

    // Generate a unique reference number: CF-YYYY-000001
    const year = new Date().getFullYear();
    const existingCount = await db.document.count({
      where: {
        referenceNumber: {
          startsWith: `CF-${year}-`,
        },
      },
    });

    let referenceNumber: string;
    let sequence = existingCount + 1;
    // Loop to guarantee uniqueness in case of race conditions
    while (true) {
      referenceNumber = `CF-${year}-${String(sequence).padStart(6, "0")}`;
      const exists = await db.document.findUnique({
        where: { referenceNumber },
        select: { id: true },
      });
      if (!exists) break;
      sequence++;
    }

    // Build metadata: formTemplateId + all field values
    const metadata: Record<string, unknown> = {
      formTemplateId: id,
      ...(fieldValues ?? {}),
    };

    // Validate classificationNodeId if provided
    if (classificationNodeId) {
      const node = await db.classificationNode.findUnique({
        where: { id: classificationNodeId },
        select: { id: true, isActive: true },
      });
      if (!node) {
        return NextResponse.json(
          { error: "Classification node not found" },
          { status: 404 }
        );
      }
      if (!node.isActive) {
        return NextResponse.json(
          { error: "Classification node is inactive" },
          { status: 400 }
        );
      }
    }

    // Create the document
    const document = await db.document.create({
      data: {
        referenceNumber,
        title: title.trim(),
        description: description?.trim() || null,
        documentType: template.name,
        status: "ACTIVE",
        department: department.trim(),
        classificationNodeId: classificationNodeId || null,
        createdById: session.user.id,
        metadata: metadata as Record<string, never>,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, displayName: true },
        },
        files: {
          select: { id: true, fileName: true, mimeType: true },
        },
      },
    });

    // Write audit log
    await writeAudit({
      userId: session.user.id,
      action: "casefolder.document_filed",
      resourceType: "Document",
      resourceId: document.id,
      metadata: {
        referenceNumber,
        title: title.trim(),
        casefolderId: id,
        casefolderName: template.name,
        department: department.trim(),
      },
    });

    logger.info("Document filed into casefolder", {
      userId: session.user.id,
      action: "casefolder.document_filed",
      route: `/api/records/casefolders/${id}`,
      method: "POST",
    });

    return NextResponse.json(serialiseBigInt(document), { status: 201 });
  } catch (error) {
    logger.error("Failed to file document into casefolder", error, {
      route: "/api/records/casefolders/[id]",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
