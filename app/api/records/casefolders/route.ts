import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/casefolders — list all active FormTemplates as casefolder
// categories, each annotated with the number of documents filed under it.
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templates = await db.formTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        isActive: true,
        version: true,
        createdAt: true,
      },
    });

    // For each template, count documents whose metadata.formTemplateId matches
    const casefolders = await Promise.all(
      templates.map(async (template) => {
        const documentCount = await db.document.count({
          where: {
            metadata: {
              path: ["formTemplateId"],
              equals: template.id,
            },
          },
        });

        return {
          id: template.id,
          name: template.name,
          description: template.description,
          fields: template.fields,
          isActive: template.isActive,
          version: template.version,
          documentCount,
          createdAt: template.createdAt,
        };
      })
    );

    return NextResponse.json({ casefolders });
  } catch (error) {
    logger.error("Failed to list casefolders", error, {
      route: "/api/records/casefolders",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
