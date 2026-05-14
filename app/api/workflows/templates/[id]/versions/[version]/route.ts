import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/workflows/templates/[id]/versions/[version]
 *
 * Fetch a single snapshot including its full graph definition. The
 * diff panel uses this to compare a historical version to the
 * current draft.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, version } = await params;
    const versionNum = Number(version);
    if (!Number.isFinite(versionNum)) {
      return NextResponse.json({ error: "Invalid version" }, { status: 400 });
    }

    const snapshot = await db.workflowTemplateVersion.findUnique({
      where: { templateId_version: { templateId: id, version: versionNum } },
      select: {
        id: true,
        version: true,
        name: true,
        description: true,
        definition: true,
        publishedAt: true,
        note: true,
        publishedBy: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    if (!snapshot) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({ snapshot });
  } catch (error) {
    logger.error("Failed to fetch workflow template version", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
