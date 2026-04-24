import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { evaluateTriggers } from "@/lib/workflow-triggers";

function serialise<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}

/**
 * GET  /api/workflows/triggers — list triggers
 * POST /api/workflows/triggers — create trigger
 *       body: { name, templateId, conditions, documentType?, department?, subjectTemplate?, isActive? }
 *
 * POST /api/workflows/triggers?action=evaluate&documentId=xxx
 *       Manually evaluate triggers against a document (for testing)
 */

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const isActiveOnly = searchParams.get("active") !== "false";

    const triggers = await db.workflowTrigger.findMany({
      where: isActiveOnly ? { isActive: true } : {},
      include: { template: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(serialise({ triggers }));
  } catch (error) {
    logger.error("Failed to list workflow triggers", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!hasPermission) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // Manual evaluation for testing
    if (action === "evaluate") {
      const documentId = searchParams.get("documentId");
      if (!documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 });

      const createdIds = await evaluateTriggers(documentId);
      return NextResponse.json({ triggered: createdIds.length, instanceIds: createdIds });
    }

    const body = await req.json();
    const { name, templateId, conditions, documentType, department, subjectTemplate, isActive } = body as {
      name: string;
      templateId: string;
      conditions: { field: string; operator: string; value: string }[];
      documentType?: string;
      department?: string;
      subjectTemplate?: string;
      isActive?: boolean;
    };

    if (!name || !templateId || !conditions?.length) {
      return NextResponse.json(
        { error: "name, templateId, and at least one condition are required" },
        { status: 400 }
      );
    }

    const template = await db.workflowTemplate.findUnique({ where: { id: templateId } });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const trigger = await db.workflowTrigger.create({
      data: {
        name,
        templateId,
        conditions: conditions as object,
        documentType: documentType ?? null,
        department: department ?? null,
        subjectTemplate: subjectTemplate ?? null,
        isActive: isActive ?? true,
        createdById: session.user.id,
      },
      include: { template: { select: { id: true, name: true } } },
    });

    return NextResponse.json(serialise({ trigger }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create workflow trigger", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
