import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { retryFailedShipments, siemEnabled } from "@/lib/siem";

/**
 * POST /api/admin/siem/retry
 *
 * Operator-triggered drain of the SIEM ship queue.  This first re-queues
 * any rows that have been parked in FAILED state (resetting them to
 * PENDING with attempts=0) so admins can replay events the worker had
 * given up on, then immediately runs one batch of `retryFailedShipments`
 * to report results synchronously.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (!siemEnabled()) {
      return NextResponse.json({
        ok: false,
        error: "SIEM_TARGET not configured",
      });
    }
    // Re-queue permanently-failed rows so they get another shot.
    const requeued = await db.siemShipLog.updateMany({
      where: { status: "FAILED" },
      data: { status: "PENDING", attempts: 0, lastError: null },
    });
    const result = await retryFailedShipments(200);
    return NextResponse.json({ ok: true, requeued: requeued.count, ...result });
  } catch (error) {
    logger.error("SIEM retry endpoint failed", error, {
      route: "/api/admin/siem/retry",
    });
    const message = error instanceof Error ? error.message : "Retry failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
