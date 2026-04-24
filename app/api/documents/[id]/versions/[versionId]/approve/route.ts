import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { markLatest } from "@/lib/version-control";
import { notifyVersionApproved, notifyVersionRejected } from "@/lib/version-notifications";

// ---------------------------------------------------------------------------
// POST /api/documents/[id]/versions/[versionId]/approve
// Body: { action: "approve" | "reject", reason?: string }
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

    // Only admins/records managers can approve
    const isApprover = (session.user as { roles?: string[] }).roles?.some(
      (r) => ["admin", "super_admin", "records_manager"].includes(r.toLowerCase())
    );
    if (!isApprover) {
      return NextResponse.json({ error: "Insufficient permissions to approve versions" }, { status: 403 });
    }

    const { id, versionId } = await params;

    const version = await db.documentVersion.findFirst({
      where: { id: versionId, documentId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    if (version.status !== "IN_REVIEW") {
      return NextResponse.json(
        { error: `Version must be IN_REVIEW to approve/reject (current: ${version.status})` },
        { status: 400 }
      );
    }

    const body = await req.json() as { action: "approve" | "reject"; reason?: string };
    if (!body.action || !["approve", "reject"].includes(body.action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    const approver = await db.user.findUnique({
      where: { id: session.user.id },
      select: { displayName: true },
    });
    const approverName = approver?.displayName ?? session.user.id;

    if (body.action === "approve") {
      await db.documentVersion.update({
        where: { id: versionId },
        data: {
          status: "APPROVED",
          approvedById: session.user.id,
          approvedAt: new Date(),
          isLatest: true,
        },
      });

      // Mark all other versions as SUPERSEDED if they were APPROVED
      await db.documentVersion.updateMany({
        where: {
          documentId: id,
          status: "APPROVED",
          id: { not: versionId },
        },
        data: { status: "SUPERSEDED" },
      });

      await markLatest(db, id, versionId);
      await notifyVersionApproved(db, id, version.versionNum, approverName).catch(
        (e) => logger.warn("notifyVersionApproved failed", { err: String(e) })
      );
    } else {
      await db.documentVersion.update({
        where: { id: versionId },
        data: { status: "REJECTED" },
      });
      await notifyVersionRejected(db, id, version.versionNum, body.reason ?? "No reason provided").catch(
        (e) => logger.warn("notifyVersionRejected failed", { err: String(e) })
      );
    }

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: body.action === "approve" ? "document.version_approved" : "document.version_rejected",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { versionId, versionNum: version.versionNum, reason: body.reason },
    });

    return NextResponse.json({
      message: body.action === "approve" ? "Version approved and set as latest" : "Version rejected",
    });
  } catch (error) {
    logger.error("Version approve/reject failed", error, {
      route: "/api/documents/[id]/versions/[versionId]/approve",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
