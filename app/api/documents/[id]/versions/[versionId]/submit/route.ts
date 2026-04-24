import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/versions/[versionId]/submit
// Moves a DRAFT version to IN_REVIEW status
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

    const version = await db.documentVersion.findFirst({
      where: { id: versionId, documentId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Cannot submit a version with status ${version.status} for review` },
        { status: 400 }
      );
    }

    if (version.createdById !== session.user.id) {
      const isAdmin = (session.user as { roles?: string[] }).roles?.some(
        (r) => r.toLowerCase() === "admin" || r.toLowerCase() === "super_admin"
      );
      if (!isAdmin) {
        return NextResponse.json(
          { error: "Only the version author or an admin can submit for review" },
          { status: 403 }
        );
      }
    }

    const updated = await db.documentVersion.update({
      where: { id: versionId },
      data: { status: "IN_REVIEW" },
    });

    const doc = await db.document.findUnique({
      where: { id },
      select: { referenceNumber: true },
    });

    // Notify users with admin or records-manager role
    const adminUsers = await db.userRole.findMany({
      where: {
        role: { name: { in: ["admin", "super_admin", "records_manager"] } },
      },
      select: { userId: true },
    });
    const adminUserIds = [...new Set(adminUsers.map((u) => u.userId))];
    if (adminUserIds.length > 0) {
      await db.notification.createMany({
        data: adminUserIds.map((userId) => ({
          userId,
          type: "VERSION_REVIEW",
          title: `Version submitted for review: Doc #${doc?.referenceNumber}`,
          body: `Version ${version.versionNum} requires approval`,
          linkUrl: `/records/documents/${id}/versions`,
        })),
        skipDuplicates: true,
      });
    }

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.version_submitted",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { versionId, versionNum: version.versionNum },
    });

    return NextResponse.json({
      message: "Version submitted for review",
      status: updated.status,
    });
  } catch (error) {
    logger.error("Version submit failed", error, {
      route: "/api/documents/[id]/versions/[versionId]/submit",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
