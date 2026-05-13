import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { downloadSignedPdf, verifyWebhookSignature } from "@/lib/nitro";
import { getNitroConfig } from "@/lib/settings";

const SIGNED_DIR = path.join(process.cwd(), "uploads", "signed-memos");

/**
 * POST /api/nitro/webhook
 *
 * Nitro Connect callback. Configure the webhook URL on the Nitro side
 * (Connect → endpoints) to POST transaction + recipient events here.
 *
 * Public endpoint (whitelisted in proxy.ts) — authentication is by HMAC
 * signature when a webhook secret is configured. We additionally only
 * act on transactionIds we created.
 */
export async function POST(req: NextRequest) {
  try {
    // Read the raw body once for HMAC verification, then parse.
    const raw = await req.text();
    const signature =
      req.headers.get("x-nitro-signature") ??
      req.headers.get("x-signature") ??
      null;

    const cfg = await getNitroConfig();
    if (!verifyWebhookSignature(raw, signature, cfg?.webhookSecret ?? "")) {
      logger.warn("Nitro Sign webhook signature verification failed");
      return NextResponse.json({ error: "Bad signature" }, { status: 401 });
    }

    const body = (raw ? JSON.parse(raw) : {}) as {
      transactionId?: string;
      data?: { transactionId?: string; status?: string };
      status?: string;
      event?: string;
    };

    const transactionId =
      body?.data?.transactionId ?? body.transactionId ?? null;
    const status =
      body?.data?.status ?? body.status ?? body.event ?? "unknown";

    if (!transactionId) return NextResponse.json({ ok: true });

    const task = await db.workflowTask.findFirst({
      where: { nitroTransactionId: transactionId },
    });
    if (!task) {
      logger.warn("Nitro Sign webhook for unknown transaction", {
        transactionId,
      });
      return NextResponse.json({ ok: true });
    }

    await db.workflowTask.update({
      where: { id: task.id },
      data: { nitroStatus: status },
    });

    if (status === "completed" && task.status === "PENDING") {
      try {
        const pdfBuf = await downloadSignedPdf(transactionId);
        await fs.mkdir(SIGNED_DIR, { recursive: true });
        const filename = `${task.instanceId}.${transactionId}.pdf`;
        await fs.writeFile(path.join(SIGNED_DIR, filename), pdfBuf);
        const relPath = path.posix.join(
          "uploads",
          "signed-memos",
          filename,
        );

        await db.workflowTask.update({
          where: { id: task.id },
          data: {
            status: "COMPLETED",
            action: "APPROVED",
            completedAt: new Date(),
            comment: "Signed with Nitro Sign (webhook)",
            nitroSignedAt: new Date(),
            nitroSignedPdf: relPath,
          },
        });

        await writeAudit({
          userId: task.assigneeId ?? undefined,
          action: "MEMO_NITRO_SIGNED_VIA_WEBHOOK",
          resourceType: "workflow_task",
          resourceId: task.id,
          metadata: { transactionId, pdfBytes: pdfBuf.length },
        });
      } catch (err) {
        logger.error("Failed to ingest signed PDF from Nitro webhook", err, {
          transactionId,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Nitro Sign webhook handler failed", error, {
      route: "/api/nitro/webhook",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
