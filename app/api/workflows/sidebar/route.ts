import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/workflows/sidebar
 * Returns published workflow templates that have a slug configured.
 * Also includes `linkedFormId` — the FormTemplate whose workflowTemplateId
 * points back to this template (used by /w/[slug]/create to skip the
 * generic start page and go directly to the form).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const modules = await db.workflowTemplate.findMany({
      where: { isActive: true, slug: { not: null } },
      orderBy: [{ sidebarOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        instanceName: true,
        sidebarIcon: true,
        sidebarOrder: true,
        customQueries: true,
      },
    });

    // Reverse-lookup: find which form template is linked to each workflow
    const templateIds = modules.map((m) => m.id);
    const linkedForms = await db.formTemplate.findMany({
      where: { workflowTemplateId: { in: templateIds } },
      select: { id: true, workflowTemplateId: true },
    });
    const formByWorkflow = new Map(
      linkedForms.map((f) => [f.workflowTemplateId!, f.id])
    );

    const enriched = modules.map((m) => ({
      ...m,
      linkedFormId: formByWorkflow.get(m.id) ?? null,
    }));

    return NextResponse.json({ modules: enriched });
  } catch (error) {
    logger.error("Failed to fetch workflow sidebar modules", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
