import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/capture/profiles -- list all capture profiles with log counts
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profiles = await db.captureProfile.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { logs: true },
        },
        logs: {
          select: { status: true },
        },
      },
    });

    const enriched = profiles.map((profile) => {
      const captured = profile.logs.filter((l) => l.status === "CAPTURED").length;
      const errors = profile.logs.filter((l) => l.status === "ERROR").length;
      const pending = profile.logs.filter(
        (l) => l.status === "PENDING" || l.status === "PROCESSING"
      ).length;
      const duplicates = profile.logs.filter((l) => l.status === "DUPLICATE").length;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logs, _count, ...rest } = profile;

      return {
        ...rest,
        logCounts: {
          total: _count.logs,
          captured,
          errors,
          pending,
          duplicates,
        },
      };
    });

    return NextResponse.json({ profiles: enriched });
  } catch (error) {
    logger.error("Failed to list capture profiles", error, {
      route: "/api/capture/profiles",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/capture/profiles -- create a new capture profile
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      name,
      description,
      folderPath,
      processedPath,
      errorPath,
      fileTypes,
      pollingInterval,
      formTemplateId,
      department,
      classificationNodeId,
      metadataMapping,
      duplicateAction,
      autoWorkflow,
      workflowTemplateId,
    } = body as {
      name?: string;
      description?: string;
      folderPath?: string;
      processedPath?: string;
      errorPath?: string;
      fileTypes?: string[];
      pollingInterval?: number;
      formTemplateId?: string;
      department?: string;
      classificationNodeId?: string;
      metadataMapping?: Record<string, unknown>;
      duplicateAction?: string;
      autoWorkflow?: boolean;
      workflowTemplateId?: string;
    };

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Profile name is required" },
        { status: 400 }
      );
    }

    if (!folderPath?.trim()) {
      return NextResponse.json(
        { error: "Folder path is required" },
        { status: 400 }
      );
    }

    if (!fileTypes || !Array.isArray(fileTypes) || fileTypes.length === 0) {
      return NextResponse.json(
        { error: "At least one file type is required" },
        { status: 400 }
      );
    }

    // Validate duplicate action
    const validDuplicateActions = ["SKIP", "VERSION", "FLAG"];
    if (duplicateAction && !validDuplicateActions.includes(duplicateAction)) {
      return NextResponse.json(
        { error: "Invalid duplicate action. Must be SKIP, VERSION, or FLAG" },
        { status: 400 }
      );
    }

    // Check name uniqueness
    const existing = await db.captureProfile.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A capture profile with this name already exists" },
        { status: 409 }
      );
    }

    const profile = await db.captureProfile.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        folderPath: folderPath.trim(),
        processedPath: processedPath?.trim() || null,
        errorPath: errorPath?.trim() || null,
        fileTypes: fileTypes.map((ft) => ft.toLowerCase().replace(/^\./, "")),
        pollingInterval: pollingInterval ?? 30,
        formTemplateId: formTemplateId || null,
        department: department?.trim() || null,
        classificationNodeId: classificationNodeId || null,
        metadataMapping: (metadataMapping ?? {}) as Record<string, never>,
        duplicateAction: duplicateAction ?? "SKIP",
        autoWorkflow: autoWorkflow ?? false,
        workflowTemplateId: workflowTemplateId || null,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "capture_profile.create",
      resourceType: "CaptureProfile",
      resourceId: profile.id,
      metadata: { name: profile.name, folderPath: profile.folderPath },
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create capture profile", error, {
      route: "/api/capture/profiles",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
