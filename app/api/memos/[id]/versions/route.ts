import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/[id]/versions
 *
 * Returns the chronological list of PDF snapshots for a memo. Used by
 * the Versions panel on the memo view to render one row per change.
 * Access is gated by the same involvement filter as the memo detail
 * route — initiator, current assignee, prior actor, or elevated role.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const memo = await db.workflowInstance.findUnique({
      where: { id },
      select: {
        documentId: true,
        initiatedById: true,
        tasks: { select: { assigneeId: true, status: true, stepIndex: true } },
      },
    });
    if (!memo || !memo.documentId) {
      return NextResponse.json({ versions: [] });
    }

    const userId = session.user.id;
    const userRoles = (session.user.roles as string[] | undefined) ?? [];
    const ELEVATED = new Set([
      "VICE_CHANCELLOR", "DVC_PFA", "DVC_ARSA",
      "ADMIN", "DIRECTOR", "DEAN", "REGISTRAR_PA",
    ]);
    const elevated = userRoles.some((r) => ELEVATED.has(r));
    const pending = memo.tasks.filter((t) => t.status === "PENDING");
    const lowestPending =
      pending.length > 0 ? Math.min(...pending.map((t) => t.stepIndex)) : Infinity;
    const allowed =
      elevated ||
      memo.initiatedById === userId ||
      memo.tasks.some((t) => t.assigneeId === userId && t.status === "COMPLETED") ||
      pending.some((t) => t.assigneeId === userId && t.stepIndex === lowestPending);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const versions = await db.documentVersion.findMany({
      where: { documentId: memo.documentId },
      orderBy: { versionNum: "desc" },
      select: {
        id: true,
        versionNum: true,
        changeNote: true,
        isLatest: true,
        sizeBytes: true,
        createdAt: true,
        createdById: true,
      },
    });

    // Resolve creator display names in one round-trip.
    const userIds = Array.from(new Set(versions.map((v) => v.createdById)));
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.displayName || u.name]));

    return NextResponse.json({
      versions: versions.map((v) => ({
        ...v,
        sizeBytes: Number(v.sizeBytes),
        createdByName: userMap.get(v.createdById) ?? "Unknown",
      })),
    });
  } catch (error) {
    logger.error("Failed to list memo versions", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
