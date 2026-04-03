import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { scanProfile } from "../route";

// ---------------------------------------------------------------------------
// POST /api/capture/scan/[profileId] -- scan a single capture profile
// ---------------------------------------------------------------------------
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { profileId } = await params;

    const profile = await db.captureProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      return NextResponse.json(
        { error: "Capture profile not found" },
        { status: 404 }
      );
    }

    if (!profile.isActive) {
      return NextResponse.json(
        { error: "Capture profile is not active" },
        { status: 400 }
      );
    }

    const result = await scanProfile(profile, session.user.id);

    await writeAudit({
      userId: session.user.id,
      action: "capture.scan_single",
      resourceType: "CaptureProfile",
      resourceId: profileId,
      metadata: {
        profileName: profile.name,
        captured: result.captured,
        duplicates: result.duplicates,
        errors: result.errors,
      },
    });

    return NextResponse.json({
      scanned: 1,
      captured: result.captured,
      duplicates: result.duplicates,
      errors: result.errors,
    });
  } catch (error) {
    logger.error("Failed to scan single capture profile", error, {
      route: "/api/capture/scan/[profileId]",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
