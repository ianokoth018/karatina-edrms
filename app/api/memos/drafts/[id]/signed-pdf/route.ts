import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/drafts/[id]/signed-pdf
 *
 * Streams the DocuSign-signed PDF (combined with cert of completion)
 * for the draft, so the composer can render it inline in an iframe to
 * replace the HTML preview once the initiator has signed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const draft = await db.memoDraft.findUnique({
      where: { id },
      select: { userId: true, signedPdfPath: true, subject: true },
    });
    if (!draft || draft.userId !== session.user.id || !draft.signedPdfPath) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const abs = path.resolve(process.cwd(), draft.signedPdfPath);
    const buf = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="draft.signed.pdf"`,
      },
    });
  } catch (error) {
    logger.error("Failed to stream draft signed PDF", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
