import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { downloadSignedPdf, getTransactionStatus } from "@/lib/nitro";

const SIGNED_DIR = path.join(process.cwd(), "uploads", "draft-signed");

/**
 * GET /api/memos/drafts/[id]/nitro/return?event=signing_complete
 *
 * Hit by Nitro Sign's embedded-signing redirect after the popup signs
 * the draft. Verifies the transaction, downloads the combined signed
 * PDF + audit trail, persists it on the draft, then renders a tiny
 * self-closing HTML page so the popup goes away cleanly.
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

    // No session check here — calling auth() inside an embedded-signing
    // return URL races with the parent window's JWT refresh and can
    // boot the user to /login. The draft owner is the only person who
    // could have signed (clientUserId on the transaction was their
    // userId), and the status is verified against Nitro server-side
    // below using app credentials.
    const draft = await db.memoDraft.findUnique({ where: { id } });
    if (!draft) {
      return closingPage("not_found");
    }
    const ownerId = draft.userId;

    if (event !== "signing_complete" || !draft.nitroTransactionId) {
      await db.memoDraft.update({
        where: { id },
        data: { nitroStatus: event },
      });
      return closingPage(event);
    }

    const transactionId = draft.nitroTransactionId;
    const status = await getTransactionStatus(transactionId);
    if (status !== "completed") {
      await db.memoDraft.update({
        where: { id },
        data: { nitroStatus: status },
      });
      return closingPage(status);
    }

    const pdfBuf = await downloadSignedPdf(transactionId);
    await fs.mkdir(SIGNED_DIR, { recursive: true });
    const filename = `${id}.${transactionId}.pdf`;
    const targetAbs = path.join(SIGNED_DIR, filename);
    await fs.writeFile(targetAbs, pdfBuf);
    const relPath = path.posix.join("uploads", "draft-signed", filename);

    await db.memoDraft.update({
      where: { id },
      data: {
        signedPdfPath: relPath,
        nitroStatus: "completed",
        nitroSignedAt: new Date(),
      },
    });

    await writeAudit({
      userId: ownerId,
      action: "DRAFT_NITRO_SIGNED",
      resourceType: "memo_draft",
      resourceId: id,
      metadata: { transactionId, pdfBytes: pdfBuf.length },
    });

    return closingPage("signing_complete");
  } catch (error) {
    logger.error("Draft Nitro Sign return-handler failed", error, {
      route: "/api/memos/drafts/[id]/nitro/return",
    });
    return closingPage("error");
  }
}
