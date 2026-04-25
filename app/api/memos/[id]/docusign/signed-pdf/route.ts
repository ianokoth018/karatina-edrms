import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/[id]/docusign/signed-pdf
 *
 * Streams the cryptographically signed PDF (combined with DocuSign's
 * certificate of completion) for the memo. Visible to anyone with read
 * access to the memo — same rules as the memo GET route.
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

    const memo = await db.workflowInstance.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        initiatedById: true,
        docusignSignedPdf: true,
        tasks: {
          select: { assigneeId: true, status: true, stepIndex: true },
        },
      },
    });
    if (!memo || !memo.docusignSignedPdf) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const userId = session.user.id;
    const userRoles = (session.user.roles as string[] | undefined) ?? [];
    const ELEVATED = new Set([
      "VICE_CHANCELLOR", "DVC_PFA", "DVC_ARSA",
      "ADMIN", "DIRECTOR", "DEAN", "REGISTRAR_PA",
    ]);
    const elevated = userRoles.some((r) => ELEVATED.has(r));
    const pending = memo.tasks.filter((t) => t.status === "PENDING");
    const lowestPending =
      pending.length > 0 ? Math.min(...pending.map((t) => t.stepIndex)) : Infinity;
    const allowed =
      elevated ||
      memo.initiatedById === userId ||
      memo.tasks.some((t) => t.assigneeId === userId && t.status === "COMPLETED") ||
      pending.some((t) => t.assigneeId === userId && t.stepIndex === lowestPending);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const abs = path.resolve(process.cwd(), memo.docusignSignedPdf);
    const buf = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${memo.referenceNumber}.signed.pdf"`,
      },
    });
  } catch (error) {
    logger.error("Failed to stream signed PDF", error, {
      route: "/api/memos/[id]/docusign/signed-pdf",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
