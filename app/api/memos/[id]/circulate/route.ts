import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/memos/[id]/circulate — circulate an approved memo to users/departments
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { userIds, departments, message } = (await req.json()) as {
      userIds?: string[];
      departments?: string[];
      message?: string;
    };

    if (
      (!userIds || userIds.length === 0) &&
      (!departments || departments.length === 0)
    ) {
      return NextResponse.json(
        { error: "Select at least one user or department" },
        { status: 400 }
      );
    }

    // Fetch the memo (workflow instance)
    const memo = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        document: { select: { referenceNumber: true, title: true } },
      },
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    // Build recipient list — specific users + all users in selected departments
    const recipientIds = new Set<string>(userIds ?? []);

    if (departments && departments.length > 0) {
      const deptUsers = await db.user.findMany({
        where: {
          isActive: true,
          department: { in: departments },
        },
        select: { id: true },
      });
      for (const u of deptUsers) {
        recipientIds.add(u.id);
      }
    }

    // Don't notify the sender themselves
    recipientIds.delete(session.user.id);

    if (recipientIds.size === 0) {
      return NextResponse.json(
        { error: "No recipients found" },
        { status: 400 }
      );
    }

    const formData = memo.formData as Record<string, unknown>;
    const memoRef =
      memo.document?.referenceNumber ?? (formData?.memoReference as string) ?? memo.referenceNumber;

    // Create notifications for all recipients
    const notifications = Array.from(recipientIds).map((userId) => ({
      userId,
      type: "MEMO_CIRCULATED",
      title: `Memo Circulated: ${memo.subject}`,
      body: message
        ? `${session.user!.name} circulated memo "${memo.subject}" (${memoRef}): ${message}`
        : `${session.user!.name} circulated memo "${memo.subject}" (${memoRef}) for your information.`,
      linkUrl: `/memos/${memo.id}`,
    }));

    await db.notification.createMany({ data: notifications });

    // Record the circulation event
    await db.workflowEvent.create({
      data: {
        instanceId: memo.id,
        eventType: "MEMO_CIRCULATED",
        actorId: session.user.id,
        data: {
          actorName: session.user.name,
          recipientCount: recipientIds.size,
          departments: departments ?? [],
          userCount: userIds?.length ?? 0,
          message: message ?? null,
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "MEMO_CIRCULATE",
      resourceType: "workflow_instance",
      resourceId: memo.id,
      metadata: {
        recipientCount: recipientIds.size,
        departments: departments ?? [],
      },
    });

    return NextResponse.json({
      success: true,
      recipientCount: recipientIds.size,
    });
  } catch (error) {
    logger.error("Failed to circulate memo", error, {
      route: "/api/memos/[id]/circulate",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
