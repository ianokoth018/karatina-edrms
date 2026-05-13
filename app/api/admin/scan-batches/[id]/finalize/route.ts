import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

// QA decision rule:
//   • If missingCount > 0 → REJECTED (missing pages mean an incomplete batch
//     that must be re-scanned before it can be accepted).
//   • Else if illegibleCount / actualPages > 5% → REJECTED (KCAA tender
//     mandates legibility — anything above 5% illegible fails QA).
//   • Otherwise → COMPLETED.
// Pass rate is reported as legibleCount / max(actualPages, 1).
const ILLEGIBILITY_THRESHOLD = 0.05;

/** POST /api/admin/scan-batches/[id]/finalize — compute QA summary, set status. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const batch = await db.scanBatch.findUnique({ where: { id } });
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (batch.status !== "IN_PROGRESS")
      return NextResponse.json(
        { error: `Batch is already ${batch.status.toLowerCase()}` },
        { status: 409 }
      );

    const actual = Math.max(batch.actualPages, 0);
    const denom = Math.max(actual, 1);
    const illegibleRate = batch.illegibleCount / denom;
    const passRate = batch.legibleCount / denom;

    let decision: "COMPLETED" | "REJECTED";
    let reason: string;
    if (batch.missingCount > 0) {
      decision = "REJECTED";
      reason = `Batch has ${batch.missingCount} missing page(s)`;
    } else if (illegibleRate > ILLEGIBILITY_THRESHOLD) {
      decision = "REJECTED";
      reason = `Illegibility rate ${(illegibleRate * 100).toFixed(1)}% exceeds 5% threshold`;
    } else {
      decision = "COMPLETED";
      reason = `Pass rate ${(passRate * 100).toFixed(1)}% — within tolerance`;
    }

    const updated = await db.scanBatch.update({
      where: { id },
      data: { status: decision, finishedAt: new Date() },
    });

    await writeAudit({
      userId: session.user.id,
      action: decision === "COMPLETED" ? "admin.scan_batch_finalized" : "admin.scan_batch_rejected",
      resourceType: "ScanBatch",
      resourceId: id,
      metadata: {
        batchNumber: batch.batchNumber,
        decision,
        reason,
        actualPages: actual,
        legibleCount: batch.legibleCount,
        illegibleCount: batch.illegibleCount,
        skewedCount: batch.skewedCount,
        blankCount: batch.blankCount,
        missingCount: batch.missingCount,
        passRate: Number(passRate.toFixed(4)),
        illegibilityRate: Number(illegibleRate.toFixed(4)),
        threshold: ILLEGIBILITY_THRESHOLD,
      },
    });

    return NextResponse.json({
      batch: updated,
      summary: {
        decision,
        reason,
        passRate,
        illegibilityRate: illegibleRate,
        threshold: ILLEGIBILITY_THRESHOLD,
      },
    });
  } catch (error) {
    logger.error("Failed to finalize scan batch", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
