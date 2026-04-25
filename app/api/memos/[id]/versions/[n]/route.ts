import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/[id]/versions/[n]
 *
 * Streams the PDF for a specific memo version (or `?n=latest` shortcut).
 * Used by the Versions panel and by the Preview/Download Memo buttons
 * (with n=latest) so they always serve the freshest snapshot.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id, n } = await params;

    const memo = await db.workflowInstance.findUnique({
      where: { id },
      select: {
        documentId: true,
        referenceNumber: true,
        initiatedById: true,
        tasks: { select: { assigneeId: true, status: true, stepIndex: true } },
      },
    });
    if (!memo || !memo.documentId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Same access rule as the memo detail route.
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

    let version = n === "latest"
      ? await db.documentVersion.findFirst({
          where: { documentId: memo.documentId, isLatest: true },
          select: { storagePath: true, versionNum: true },
        })
      : await db.documentVersion.findUnique({
          where: {
            documentId_versionNum: {
              documentId: memo.documentId,
              versionNum: Number(n),
            },
          },
          select: { storagePath: true, versionNum: true },
        });

    // For ELECTRONIC memos: if the latest snapshot was created before
    // the signature loader was added (or before the user uploaded a
    // signature), regenerate it once so Preview/Download Memo shows
    // the embedded signature. The marker "[sig]" in the changeNote
    // tells us a snapshot already includes the signature, so we only
    // refresh when needed.
    const SIG_MARKER = "[sig]";
    if (n === "latest") {
      const instSig = await db.workflowInstance.findUnique({
        where: { id },
        select: { signatureMethod: true, initiatedById: true },
      });
      if (instSig?.signatureMethod === "electronic") {
        const initiator = await db.user.findUnique({
          where: { id: instSig.initiatedById },
          select: { signatureImage: true },
        });
        const latestRow = version
          ? await db.documentVersion.findFirst({
              where: { documentId: memo.documentId, isLatest: true },
              select: { changeNote: true },
            })
          : null;
        const needsRefresh =
          initiator?.signatureImage &&
          (!latestRow || !latestRow.changeNote.includes(SIG_MARKER));
        if (needsRefresh) {
          const { snapshotMemoVersion } = await import("@/lib/memo-versions");
          const snap = await snapshotMemoVersion(
            id,
            `${SIG_MARKER} Snapshot refreshed with current electronic signature`,
            session.user.id,
          );
          if (snap) {
            version = await db.documentVersion.findFirst({
              where: { documentId: memo.documentId, versionNum: snap.versionNum },
              select: { storagePath: true, versionNum: true },
            });
          }
        }
      }
    }

    // For memos that were digitally signed but whose signed-PDF
    // version row never got created (e.g. signing happened before
    // versioning shipped, or recordMemoVersion failed silently),
    // reconcile now: if the WorkflowInstance has a docusignSignedPdf
    // on disk and the latest version *isn't* that signed file, import
    // the signed PDF as a new latest version. The signed bytes are
    // ground truth — the user expects to see them in Preview/Download.
    if (n === "latest") {
      const inst = await db.workflowInstance.findUnique({
        where: { id },
        select: { docusignSignedPdf: true, docusignSignedAt: true },
      });
      if (
        inst?.docusignSignedPdf &&
        (!version || !version.storagePath.endsWith(path.basename(inst.docusignSignedPdf)))
      ) {
        try {
          const signedAbs = path.resolve(process.cwd(), inst.docusignSignedPdf);
          const buf = await fs.readFile(signedAbs);
          const { recordMemoVersion } = await import("@/lib/memo-versions");
          const snap = await recordMemoVersion({
            documentId: memo.documentId,
            pdfBytes: new Uint8Array(buf),
            changeNote: `Digitally signed with DocuSign${
              inst.docusignSignedAt
                ? ` at ${new Date(inst.docusignSignedAt).toLocaleString()}`
                : ""
            }`,
            createdById: session.user.id,
          });
          if (snap) {
            version = await db.documentVersion.findFirst({
              where: { documentId: memo.documentId, versionNum: snap.versionNum },
              select: { storagePath: true, versionNum: true },
            });
          }
        } catch {
          // Fall through to other recovery paths.
        }
      }
    }

    // Lazy v1 — for memos created before versioning landed (or if a
    // race left a memo without any snapshots AND no signed PDF), render
    // the standard template so Preview/Download Memo always has
    // something to serve.
    if (!version && n === "latest") {
      const { snapshotMemoVersion } = await import("@/lib/memo-versions");
      const snap = await snapshotMemoVersion(
        id,
        "Initial snapshot (lazy)",
        session.user.id,
      );
      if (snap) {
        version = await db.documentVersion.findFirst({
          where: { documentId: memo.documentId, versionNum: snap.versionNum },
          select: { storagePath: true, versionNum: true },
        });
      }
    }

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const abs = path.resolve(process.cwd(), version.storagePath);
    const buf = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${memo.referenceNumber}.v${version.versionNum}.pdf"`,
      },
    });
  } catch (error) {
    logger.error("Failed to stream memo version", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
