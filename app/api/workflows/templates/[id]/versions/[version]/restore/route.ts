import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * POST /api/workflows/templates/[id]/versions/[version]/restore
 *
 * Restore a historical snapshot as the current draft definition.
 * Unpublishes the template so the restore behaves like an editable
 * draft until the admin reviews and publishes it.
 *
 * No new version row is created here — that happens on the next
 * publish, which captures the restored graph.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, version } = await params;
    const versionNum = Number(version);
    if (!Number.isFinite(versionNum)) {
      return NextResponse.json({ error: "Invalid version" }, { status: 400 });
    }

    const [template, snapshot] = await Promise.all([
      db.workflowTemplate.findUnique({
        where: { id },
        select: { id: true, version: true, isActive: true },
      }),
      db.workflowTemplateVersion.findUnique({
        where: { templateId_version: { templateId: id, version: versionNum } },
        select: { definition: true, name: true, description: true },
      }),
    ]);

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    if (!snapshot) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const updated = await db.workflowTemplate.update({
      where: { id },
      data: {
        definition: snapshot.definition as object,
        name: snapshot.name,
        description: snapshot.description,
        version: template.version + 1,
        // Unpublish so the restored graph is treated as a draft that
        // needs explicit re-approval before going live again.
        isActive: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        version: true,
        isActive: true,
        slug: true,
        instanceName: true,
        sidebarIcon: true,
        sidebarOrder: true,
        customQueries: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "WORKFLOW_TEMPLATE_RESTORED",
      resourceType: "workflow_template",
      resourceId: id,
      metadata: { restoredFromVersion: versionNum, newVersion: updated.version },
    });

    return NextResponse.json({ template: updated });
  } catch (error) {
    logger.error("Failed to restore workflow template version", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
