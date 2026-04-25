import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { downloadSignedPdf, getEnvelopeStatus } from "@/lib/docusign";

const SIGNED_DIR = path.join(process.cwd(), "uploads", "draft-signed");

/**
 * GET /api/memos/drafts/[id]/docusign/return?event=signing_complete
 *
 * Hit by DocuSign's embedded-signing redirect after the popup signs the
 * draft. Verifies the envelope, downloads the combined signed PDF +
 * certificate of completion, persists it on the draft, then renders a
 * tiny self-closing HTML page so the popup goes away cleanly.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  function closingPage(event: string): NextResponse {
    return new NextResponse(
      `<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#333">` +
        `<p>${event === "signing_complete" ? "Signed. You can close this window." : `Status: ${event}`}</p>` +
        `<script>setTimeout(() => window.close(), 600);</script>` +
        `</body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  }

  try {
    const event = req.nextUrl.searchParams.get("event") ?? "unknown";

    // No session check — calling auth() here races with the parent
    // window's JWT refresh and can boot the user to /login. The draft
    // owner is the only person who can have signed (clientUserId on
    // the envelope was their userId), and the envelope status is
    // verified against DocuSign's API below using server credentials.
    const draft = await db.memoDraft.findUnique({ where: { id } });
    if (!draft) {
      return closingPage("not_found");
    }
    const ownerId = draft.userId;

    if (event !== "signing_complete" || !draft.docusignEnvelopeId) {
      await db.memoDraft.update({
        where: { id },
        data: { docusignStatus: event },
      });
      return closingPage(event);
    }

    const envelopeId = draft.docusignEnvelopeId;
    const status = await getEnvelopeStatus(envelopeId);
    if (status !== "completed") {
      await db.memoDraft.update({
        where: { id },
        data: { docusignStatus: status },
      });
      return closingPage(status);
    }

    const pdfBuf = await downloadSignedPdf(envelopeId);
    await fs.mkdir(SIGNED_DIR, { recursive: true });
    const filename = `${id}.${envelopeId}.pdf`;
    const targetAbs = path.join(SIGNED_DIR, filename);
    await fs.writeFile(targetAbs, pdfBuf);
    const relPath = path.posix.join("uploads", "draft-signed", filename);

    await db.memoDraft.update({
      where: { id },
      data: {
        signedPdfPath: relPath,
        docusignStatus: "completed",
        docusignSignedAt: new Date(),
      },
    });

    await writeAudit({
      userId: ownerId,
      action: "DRAFT_DOCUSIGN_SIGNED",
      resourceType: "memo_draft",
      resourceId: id,
      metadata: { envelopeId, pdfBytes: pdfBuf.length },
    });

    return closingPage("signing_complete");
  } catch (error) {
    logger.error("Draft DocuSign return-handler failed", error, {
      route: "/api/memos/drafts/[id]/docusign/return",
    });
    return closingPage("error");
  }
}
