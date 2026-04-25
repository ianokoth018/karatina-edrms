import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { downloadSignedPdf } from "@/lib/docusign";

const SIGNED_DIR = path.join(process.cwd(), "uploads", "signed-memos");

/**
 * POST /api/docusign/webhook
 *
 * DocuSign Connect callback. Configure the webhook URL on the DocuSign
 * side (Settings → Connect) to point here, with "Envelope and Recipient
 * status" events enabled. The body is JSON.
 *
 * Public endpoint (whitelisted in proxy.ts) — DocuSign authenticates via
 * mutual TLS / HMAC; we additionally only act on envelopeIds we created.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      data?: {
        envelopeId?: string;
        envelopeSummary?: { status?: string };
      };
      event?: string;
    };

    const envelopeId =
      body?.data?.envelopeId ?? (body as { envelopeId?: string }).envelopeId;
    const status =
      body?.data?.envelopeSummary?.status ??
      (body as { status?: string }).status ??
      body?.event ??
      "unknown";

    if (!envelopeId) return NextResponse.json({ ok: true });

    const task = await db.workflowTask.findFirst({
      where: { docusignEnvelopeId: envelopeId },
    });
    if (!task) {
      logger.warn("DocuSign webhook for unknown envelope", { envelopeId });
      return NextResponse.json({ ok: true });
    }

    await db.workflowTask.update({
      where: { id: task.id },
      data: { docusignStatus: status },
    });

    if (status === "completed" && task.status === "PENDING") {
      try {
        const pdfBuf = await downloadSignedPdf(envelopeId);
        await fs.mkdir(SIGNED_DIR, { recursive: true });
        const filename = `${task.instanceId}.${envelopeId}.pdf`;
        await fs.writeFile(path.join(SIGNED_DIR, filename), pdfBuf);
        const relPath = path.posix.join("uploads", "signed-memos", filename);

        await db.workflowTask.update({
          where: { id: task.id },
          data: {
            status: "COMPLETED",
            action: "APPROVED",
            completedAt: new Date(),
            comment: "Signed with DocuSign (webhook)",
            docusignSignedAt: new Date(),
            docusignSignedPdf: relPath,
          },
        });

        await writeAudit({
          userId: task.assigneeId ?? undefined,
          action: "MEMO_DOCUSIGN_SIGNED_VIA_WEBHOOK",
          resourceType: "workflow_task",
          resourceId: task.id,
          metadata: { envelopeId, pdfBytes: pdfBuf.length },
        });
      } catch (err) {
        logger.error("Failed to ingest signed PDF from webhook", err, {
          envelopeId,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("DocuSign webhook handler failed", error, {
      route: "/api/docusign/webhook",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
