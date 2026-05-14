import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/workflows/templates/[id]/versions
 *
 * List all published snapshots for a template, newest first. The
 * designer's history panel uses this to render the version timeline.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const versions = await db.workflowTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        name: true,
        description: true,
        publishedAt: true,
        note: true,
        publishedBy: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    return NextResponse.json({ versions });
  } catch (error) {
    logger.error("Failed to list workflow template versions", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
