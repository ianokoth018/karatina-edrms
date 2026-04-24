import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { markLatest } from "@/lib/version-control";
import { notifyVersionApproved, notifyVersionRejected } from "@/lib/version-notifications";

function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(serialiseBigInt);
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = serialiseBigInt(v);
    }
    return out;
  }
  return data;
}

// ---------------------------------------------------------------------------
// PATCH /api/documents/[id]/versions/[versionId]
// Body: { label?, changeNote?, status? }
// ---------------------------------------------------------------------------
export async function PATCH(
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

    const body = await req.json() as {
      label?: string;
      changeNote?: string;
      status?: "DRAFT" | "IN_REVIEW" | "APPROVED" | "SUPERSEDED" | "REJECTED";
    };

    const allowedTransitions: Record<string, string[]> = {
      DRAFT: ["IN_REVIEW"],
      IN_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
      APPROVED: ["SUPERSEDED"],
      REJECTED: ["DRAFT"],
      SUPERSEDED: [],
    };

    if (body.status && body.status !== version.status) {
      const allowed = allowedTransitions[version.status] ?? [];
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          { error: `Cannot transition from ${version.status} to ${body.status}` },
          { status: 400 }
        );
      }
    }

    const updated = await db.documentVersion.update({
      where: { id: versionId },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.changeNote !== undefined ? { changeNote: body.changeNote } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.status === "APPROVED"
          ? { approvedById: session.user.id, approvedAt: new Date(), isLatest: true }
          : {}),
      },
    });

    if (body.status === "APPROVED") {
      await markLatest(db, id, versionId);
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { displayName: true },
      });
      await notifyVersionApproved(db, id, version.versionNum, user?.displayName ?? session.user.id).catch(
        (e) => logger.warn("notifyVersionApproved failed", { err: String(e) })
      );
    }

    if (body.status === "REJECTED" && body.changeNote) {
      await notifyVersionRejected(db, id, version.versionNum, body.changeNote).catch(
        (e) => logger.warn("notifyVersionRejected failed", { err: String(e) })
      );
    }

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.version_updated",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { versionId, changes: body },
    });

    return NextResponse.json(serialiseBigInt(updated));
  } catch (error) {
    logger.error("Failed to update version", error, {
      route: "/api/documents/[id]/versions/[versionId]",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
