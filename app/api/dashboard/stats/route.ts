import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const [totalDocuments, activeWorkflows, pendingTasks, recentUploads, myMemos, pendingMemos] =
      await Promise.all([
        db.document.count().catch(() => 0),
        db.workflowInstance
          .count({
            where: {
              status: { in: ["PENDING", "IN_PROGRESS"] },
            },
          })
          .catch(() => 0),
        db.workflowTask
          .count({
            where: {
              assigneeId: userId,
              status: "PENDING",
            },
          })
          .catch(() => 0),
        db.document
          .count({
            where: {
              createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
          })
          .catch(() => 0),
        db.workflowInstance
          .count({
            where: {
              // Match both legacy "MEMO" and the current "Internal Memo"
              // casefolder type used when memos are filed via the casefolder.
              document: { documentType: { in: ["MEMO", "Internal Memo"] } },
              OR: [
                { initiatedById: userId },
                { tasks: { some: { assigneeId: userId } } },
              ],
            },
          })
          .catch(() => 0),
        db.workflowTask
          .count({
            where: {
              assigneeId: userId,
              status: "PENDING",
              instance: { document: { documentType: { in: ["MEMO", "Internal Memo"] } } },
            },
          })
          .catch(() => 0),
      ]);

    return NextResponse.json({
      totalDocuments,
      activeWorkflows,
      pendingTasks,
      recentUploads,
      myMemos,
      pendingMemos,
    });
  } catch {
    return NextResponse.json({
      totalDocuments: 0,
      activeWorkflows: 0,
      pendingTasks: 0,
      recentUploads: 0,
      myMemos: 0,
      pendingMemos: 0,
    });
  }
}
