import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { downloadSignedPdf, getEnvelopeStatus } from "@/lib/docusign";

const SIGNED_DIR = path.join(process.cwd(), "uploads", "signed-memos");

/**
 * GET /api/memos/[id]/docusign/return?event=signing_complete
 *
 * Hit by DocuSign's embedded-signing redirect after the *initiator* finishes
 * (or declines / cancels). On signing_complete, we trust-but-verify with
 * DocuSign, download the combined PDF + cert of completion, and stamp the
 * WorkflowInstance — no task transitions, since signing is initiator-owned
 * and orthogonal to the approval workflow.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const memoUrl = new URL(`/memos/${id}`, req.url);

  try {
    const event = req.nextUrl.searchParams.get("event") ?? "unknown";
    memoUrl.searchParams.set("docusign", event);

    // No session check — the DocuSign return URL is hit by the popup
    // after signing, with cookies that may be stale due to refresh-
    // token rotation racing with the parent. Trust the envelope: the
    // initiator is the only person who can have signed (clientUserId
    // on the envelope was their userId), and the envelope status is
    // verified server-side via DocuSign credentials below.
    const memo = await db.workflowInstance.findUnique({
      where: { id },
      select: {
        id: true,
        initiatedById: true,
        docusignEnvelopeId: true,
      },
    });
    if (!memo) {
      return NextResponse.redirect(memoUrl);
    }
    const ownerId = memo.initiatedById;

    if (event !== "signing_complete" || !memo.docusignEnvelopeId) {
      await db.workflowInstance.update({
        where: { id },
        data: { docusignStatus: event },
      });
      return NextResponse.redirect(memoUrl);
    }

    const envelopeId = memo.docusignEnvelopeId;
    const status = await getEnvelopeStatus(envelopeId);
    if (status !== "completed") {
      await db.workflowInstance.update({
        where: { id },
        data: { docusignStatus: status },
      });
      return NextResponse.redirect(memoUrl);
    }

    const pdfBuf = await downloadSignedPdf(envelopeId);
    await fs.mkdir(SIGNED_DIR, { recursive: true });
    const filename = `${id}.${envelopeId}.pdf`;
    const targetAbs = path.join(SIGNED_DIR, filename);
    await fs.writeFile(targetAbs, pdfBuf);
    const relPath = path.posix.join("uploads", "signed-memos", filename);

    await db.workflowInstance.update({
      where: { id },
      data: {
        docusignStatus: "completed",
        docusignSignedAt: new Date(),
        docusignSignedPdf: relPath,
      },
    });

    // Record the signed PDF as a new memo version so it shows up in
    // the Versions panel and becomes what Preview/Download Memo serves.
    try {
      const inst = await db.workflowInstance.findUnique({
        where: { id },
        select: { documentId: true },
      });
      if (inst?.documentId) {
        const { recordMemoVersion } = await import("@/lib/memo-versions");
        const owner = await db.user.findUnique({
          where: { id: ownerId },
          select: { name: true, displayName: true },
        });
        await recordMemoVersion({
          documentId: inst.documentId,
          pdfBytes: new Uint8Array(pdfBuf),
          changeNote: `Digitally signed by ${owner?.displayName ?? owner?.name ?? "initiator"}`,
          createdById: ownerId,
        });
      }
    } catch (err) {
      logger.error("Failed to record signed memo version", err, { memoId: id });
    }

    await writeAudit({
      userId: ownerId,
      action: "MEMO_DOCUSIGN_SIGNED",
      resourceType: "workflow_instance",
      resourceId: id,
      metadata: { envelopeId, pdfBytes: pdfBuf.length },
    });

    memoUrl.searchParams.set("docusign", "signed");
    return NextResponse.redirect(memoUrl);
  } catch (error) {
    logger.error("DocuSign return-handler failed", error, {
      route: "/api/memos/[id]/docusign/return",
    });
    memoUrl.searchParams.set("docusign", "error");
    return NextResponse.redirect(memoUrl);
  }
}
