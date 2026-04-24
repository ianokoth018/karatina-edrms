import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { resolveAssignee } from "@/lib/workflow-engine";

/**
 * Custom JSON serialiser that converts BigInt values to strings so that
 * `JSON.stringify` does not throw.
 */
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
    const view = searchParams.get("view") || "documents"; // "documents" | "folders"
    // Field-level filters: ?filter_fieldName=value (AND logic, case-insensitive)
    const fieldFilters: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith("filter_") && value.trim()) {
        fieldFilters[key.slice(7)] = value.trim();
      }
    }
    const hasFilters = Object.keys(fieldFilters).length > 0;
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

    // --- ACL enforcement ---
    // Admins bypass all checks. For everyone else, access requires an explicit
    // ACL entry. A casefolder with no entries configured is locked to admins only.
    const isAdmin = session.user.permissions.includes("admin:manage");
    if (!isAdmin) {
      const aclEntries = await db.casefolderACL.findMany({
        where: { formTemplateId: id },
        select: { userId: true, roleId: true, departmentId: true, expiresAt: true, canView: true },
      });

      const userRoleIds = (
        await db.userRole.findMany({ where: { userId: session.user.id }, select: { roleId: true } })
      ).map((ur) => ur.roleId);

      const currentUser = await db.user.findUnique({
        where: { id: session.user.id },
        select: { department: true },
      });

      const hasAccess = aclEntries.some((acl) => {
        if (acl.expiresAt && new Date(acl.expiresAt) < new Date()) return false;
        if (!acl.canView) return false;
        if (acl.userId === session.user.id) return true;
        if (acl.roleId && userRoleIds.includes(acl.roleId)) return true;
        if (acl.departmentId && currentUser?.department && acl.departmentId === currentUser.department) return true;
        return false;
      });

      if (!hasAccess) {
        return NextResponse.json(
          { error: "You do not have permission to access this casefolder" },
          { status: 403 }
        );
      }
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

    // --- Option A: Internal Memo casefolder only surfaces fully approved memos.
    // A memo is "fully approved" when:
    //   * document.status === "ARCHIVED"  (set at final approval)
    //   * linked workflowInstance.status === "COMPLETED"  (i.e. not REJECTED /
    //     CANCELLED / still IN_PROGRESS)
    // This check must NOT apply to other casefolders (Correspondence
    // Management, etc.), which remain unfiltered.
    const isInternalMemoCasefolder = template.name === "Internal Memo";
    if (isInternalMemoCasefolder) {
      where.status = "ARCHIVED";
      where.workflowInstances = {
        some: { status: "COMPLETED" },
      };
    }

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

    // Add field-specific filters (AND logic, case-insensitive JSON metadata search)
    if (hasFilters) {
      const entries = Object.entries(fieldFilters);
      // Build a single raw query that ANDs all field conditions for efficiency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let matchingIds: { id: string }[] = [];
      if (entries.length === 1) {
        const [fieldName, value] = entries[0];
        matchingIds = await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM "documents" WHERE metadata->>${fieldName} ILIKE ${'%' + value + '%'}
        `;
      } else {
        // Multiple filters — intersect IDs across each field condition
        let intersected: string[] | null = null;
        for (const [fieldName, value] of entries) {
          const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM "documents" WHERE metadata->>${fieldName} ILIKE ${'%' + value + '%'}
          `;
          const rowIds = rows.map((r) => r.id);
          intersected = intersected === null ? rowIds : intersected.filter((id) => rowIds.includes(id));
        }
        matchingIds = (intersected ?? []).map((id) => ({ id }));
      }
      const idList = matchingIds.map((r) => r.id);
      if (where.AND) {
        where.AND.push({ id: { in: idList } });
      } else {
        where.id = { in: idList };
      }
    }

    // ---------- Folders view (aggregated) ----------
    if (view === "folders" && hasAggregation) {
      const aggFieldNames = aggregationFields.map((f: { name: string }) => f.name);
      const aggFieldLabels = aggregationFields.map((f: { label: string }) => f.label);

      // Fetch ALL documents in this casefolder (no pagination for grouping).
      // For the Internal Memo casefolder, only include fully approved memos
      // (document ARCHIVED + linked workflow COMPLETED).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allDocsWhere: any = {
        metadata: { path: ["formTemplateId"], equals: id },
        status: { not: "DISPOSED" },
      };
      if (isInternalMemoCasefolder) {
        allDocsWhere.status = "ARCHIVED";
        allDocsWhere.workflowInstances = { some: { status: "COMPLETED" } };
      }
      const allDocs = await db.document.findMany({
        where: allDocsWhere,
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

      // Convert to array and apply field filters (AND logic, case-insensitive)
      let folders = Array.from(folderMap.values());
      if (hasFilters) {
        folders = folders.filter((f) =>
          Object.entries(fieldFilters).every(([fieldName, value]) => {
            const val = f.keyParts[fieldName] ?? String(f.metadata[fieldName] ?? "");
            return val.toLowerCase().includes(value.toLowerCase());
          })
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
            select: { id: true, fileName: true, mimeType: true, storagePath: true },
          },
          workflowInstances: {
            select: { id: true, status: true, referenceNumber: true },
            take: 1,
            orderBy: { startedAt: "desc" },
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
          workflowStatus: doc.workflowInstances[0]?.status ?? null,
          workflowInstanceId: doc.workflowInstances[0]?.id ?? null,
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
      select: { id: true, name: true, fields: true, isActive: true, workflowTemplateId: true },
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

    // -----------------------------------------------------------------
    // Auto-start linked workflow (if the casefolder has one configured)
    // -----------------------------------------------------------------
    let workflowInstanceId: string | null = null;

    if (template.workflowTemplateId) {
      try {
        const workflowTemplate = await db.workflowTemplate.findUnique({
          where: { id: template.workflowTemplateId },
          select: { id: true, name: true, definition: true, isActive: true },
        });

        if (workflowTemplate && workflowTemplate.isActive) {
          // Generate workflow reference number
          const wfCount = await db.workflowInstance.count();
          const wfReferenceNumber = "WF-" + String(wfCount + 1).padStart(6, "0");

          // Create the workflow instance
          const workflowInstance = await db.workflowInstance.create({
            data: {
              referenceNumber: wfReferenceNumber,
              templateId: workflowTemplate.id,
              documentId: document.id,
              initiatedById: session.user.id,
              subject: `${workflowTemplate.name}: ${title.trim()}`,
              status: "IN_PROGRESS",
              formData: (fieldValues ?? {}) as object,
            },
          });

          workflowInstanceId = workflowInstance.id;

          // Extract the first task node via BFS from the start node
          const definition = workflowTemplate.definition as {
            nodes?: { id: string; type: string; data: Record<string, unknown> }[];
            edges?: { id: string; source: string; target: string; sourceHandle?: string | null }[];
          };

          if (definition.nodes && definition.edges) {
            const startNode = definition.nodes.find((n) => n.type === "start");
            if (startNode) {
              // BFS to find first task node
              const visited = new Set<string>();
              const queue: string[] = [startNode.id];
              let firstTaskNode: (typeof definition.nodes)[0] | null = null;

              while (queue.length > 0 && !firstTaskNode) {
                const currentId = queue.shift()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const outgoing = definition.edges.filter(
                  (e) => e.source === currentId
                );
                for (const edge of outgoing) {
                  const targetNode = definition.nodes!.find(
                    (n) => n.id === edge.target
                  );
                  if (targetNode) {
                    if (targetNode.type === "task") {
                      firstTaskNode = targetNode;
                      break;
                    }
                    queue.push(targetNode.id);
                  }
                }
              }

              if (firstTaskNode) {
                const nodeData = firstTaskNode.data ?? {};
                const assigneeRule =
                  (nodeData.assigneeRule as string) || "initiator";
                const assigneeValue =
                  (nodeData.assigneeValue as string) || undefined;

                const assigneeId = await resolveAssignee({
                  assigneeRule,
                  assigneeValue,
                  initiatorId: session.user.id,
                  instanceId: workflowInstance.id,
                });

                const effectiveAssigneeId = assigneeId || session.user.id;

                const dueAt = new Date();
                dueAt.setDate(dueAt.getDate() + 7);

                // Create the first workflow task
                await db.workflowTask.create({
                  data: {
                    instanceId: workflowInstance.id,
                    stepName:
                      (nodeData.label as string) || "Review",
                    stepIndex: 0,
                    assigneeId: effectiveAssigneeId,
                    status: "PENDING",
                    dueAt,
                  },
                });

                // Create workflow started event
                await db.workflowEvent.create({
                  data: {
                    instanceId: workflowInstance.id,
                    eventType: "WORKFLOW_STARTED",
                    actorId: session.user.id,
                    data: {
                      documentId: document.id,
                      documentTitle: title.trim(),
                      casefolderId: id,
                      casefolderName: template.name,
                      templateName: workflowTemplate.name,
                    } as object,
                  },
                });

                // Create notification for the first assignee
                await db.notification.create({
                  data: {
                    userId: effectiveAssigneeId,
                    type: "WORKFLOW_TASK",
                    title: `New task: ${(nodeData.label as string) || "Review"}`,
                    body: `Workflow "${workflowTemplate.name}" was auto-started for document "${title.trim()}" filed in casefolder "${template.name}". Please review.`,
                    linkUrl: `/workflows`,
                  },
                });
              }
            }
          }

          logger.info("Workflow auto-started for filed document", {
            userId: session.user.id,
            action: "workflow.auto_started",
            workflowInstanceId: workflowInstance.id,
            documentId: document.id,
            templateName: workflowTemplate.name,
          });
        }
      } catch (wfError) {
        // Log the error but don't fail the document filing
        logger.error("Failed to auto-start workflow for filed document", wfError, {
          route: `/api/records/casefolders/${id}`,
          method: "POST",
          documentId: document.id,
          workflowTemplateId: template.workflowTemplateId,
        });
      }
    }

    return NextResponse.json(
      serialiseBigInt({
        ...document,
        workflowInstanceId,
      }),
      { status: 201 }
    );
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
