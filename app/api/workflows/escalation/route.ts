import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { runEscalationCheck } from "@/lib/escalation-engine";

/**
 * POST /api/workflows/escalation
 * Trigger the escalation check manually or from a scheduled job.
 * Admin-only.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const perms = session.user.permissions as string[] | undefined;
    if (!perms?.includes("admin:manage") && !perms?.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await runEscalationCheck();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("Escalation check API failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** GET /api/workflows/escalation — get recent escalation logs */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const perms = session.user.permissions as string[] | undefined;
    if (!perms?.includes("admin:manage") && !perms?.includes("workflows:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { db } = await import("@/lib/db");
    const logs = await db.taskEscalationLog.findMany({
      orderBy: { firedAt: "desc" },
      take: 100,
      include: {
        task: {
          select: {
            stepName: true,
            instance: { select: { subject: true, referenceNumber: true } },
          },
        },
      },
    });

    return NextResponse.json({ logs });
  } catch (error) {
    logger.error("Failed to fetch escalation logs", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
