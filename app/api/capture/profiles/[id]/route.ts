import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/capture/profiles/[id] -- single profile with recent logs
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const profile = await db.captureProfile.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: {
          select: { logs: true },
        },
      },
    });

    if (!profile) {
      return NextResponse.json(
        { error: "Capture profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    logger.error("Failed to fetch capture profile", error, {
      route: "/api/capture/profiles/[id]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/capture/profiles/[id] -- update profile fields
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const existing = await db.captureProfile.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Capture profile not found" },
        { status: 404 }
      );
    }

    // Build update data from allowed fields
    const allowedFields = [
      "name",
      "description",
      "folderPath",
      "processedPath",
      "errorPath",
      "fileTypes",
      "pollingInterval",
      "isActive",
      "formTemplateId",
      "department",
      "classificationNodeId",
      "metadataMapping",
      "validationRules",
      "duplicateAction",
      "autoWorkflow",
      "workflowTemplateId",
    ] as const;

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field];
      }
    }

    // Normalize fileTypes if provided
    if (updateData.fileTypes && Array.isArray(updateData.fileTypes)) {
      updateData.fileTypes = (updateData.fileTypes as string[]).map((ft) =>
        ft.toLowerCase().replace(/^\./, "")
      );
    }

    // Validate name uniqueness if changed
    if (updateData.name && updateData.name !== existing.name) {
      const nameConflict = await db.captureProfile.findUnique({
        where: { name: updateData.name as string },
      });
      if (nameConflict) {
        return NextResponse.json(
          { error: "A capture profile with this name already exists" },
          { status: 409 }
        );
      }
    }

    // Validate duplicate action if provided
    if (updateData.duplicateAction) {
      const validActions = ["SKIP", "VERSION", "FLAG"];
      if (!validActions.includes(updateData.duplicateAction as string)) {
        return NextResponse.json(
          { error: "Invalid duplicate action. Must be SKIP, VERSION, or FLAG" },
          { status: 400 }
        );
      }
    }

    const profile = await db.captureProfile.update({
      where: { id },
      data: updateData,
    });

    await writeAudit({
      userId: session.user.id,
      action: "capture_profile.update",
      resourceType: "CaptureProfile",
      resourceId: profile.id,
      metadata: { updatedFields: Object.keys(updateData) },
    });

    return NextResponse.json({ profile });
  } catch (error) {
    logger.error("Failed to update capture profile", error, {
      route: "/api/capture/profiles/[id]",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/capture/profiles/[id] -- delete profile and its logs
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db.captureProfile.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Capture profile not found" },
        { status: 404 }
      );
    }

    // Cascade delete handles logs via the schema relation
    await db.captureProfile.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "capture_profile.delete",
      resourceType: "CaptureProfile",
      resourceId: id,
      metadata: { name: existing.name, folderPath: existing.folderPath },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete capture profile", error, {
      route: "/api/capture/profiles/[id]",
      method: "DELETE",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
