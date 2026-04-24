import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/workflows/templates/[id]/migrate
 *
 * Migrate active workflow instances to the current template version.
 * Updates WorkflowInstance.templateVersion and records a migration event.
 *
 * Body: { instanceIds?: string[] }  — omit to migrate ALL active instances
 *
 * NOTE: Migration only updates the version stamp. Tasks already in progress
 * continue with their existing graph position. New tasks created after
 * migration will follow the updated template definition.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!hasPermission) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: templateId } = await params;

    const template = await db.workflowTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, version: true },
    });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { instanceIds } = body as { instanceIds?: string[] };

    const where: Record<string, unknown> = {
      templateId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      templateVersion: { lt: template.version },
    };

    if (instanceIds?.length) {
      where.id = { in: instanceIds };
    }

    // Fetch instances to migrate
    const instances = await db.workflowInstance.findMany({
      where,
      select: { id: true, referenceNumber: true, templateVersion: true },
    });

    if (instances.length === 0) {
      return NextResponse.json({
        migrated: 0,
        message: "No instances require migration",
      });
    }

    // Update templateVersion on all matching instances
    const { count } = await db.workflowInstance.updateMany({
      where: { id: { in: instances.map((i) => i.id) } },
      data: { templateVersion: template.version },
    });

    // Record migration event on each instance
    await db.workflowEvent.createMany({
      data: instances.map((inst) => ({
        instanceId: inst.id,
        eventType: "WORKFLOW_VERSION_MIGRATED",
        actorId: session.user.id,
        data: {
          fromVersion: inst.templateVersion,
          toVersion: template.version,
          migratedBy: session.user.id,
        },
      })),
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_MIGRATED",
      resourceType: "workflow_template",
      resourceId: templateId,
      metadata: {
        templateName: template.name,
        toVersion: template.version,
        migratedInstances: count,
        instanceIds: instances.map((i) => i.id),
      },
    });

    logger.info("Workflow instances migrated to new template version", {
      templateId, toVersion: template.version, count,
    });

    return NextResponse.json({
      migrated: count,
      toVersion: template.version,
      instances: instances.map((i) => ({ id: i.id, referenceNumber: i.referenceNumber })),
    });
  } catch (error) {
    logger.error("Failed to migrate workflow instances", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
