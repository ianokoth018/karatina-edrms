import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateMemoPdf } from "@/lib/memo-pdf";
import { createEnvelope } from "@/lib/docusign";
import { getDepartmentMemoCode } from "@/lib/departments";

/**
 * POST /api/memos/drafts/[id]/docusign/sign
 *
 * Generates the memo PDF *from the draft's payload* (no electronic
 * signature embedded — DocuSign provides the cryptographic signature)
 * and creates a DocuSign envelope addressed to the draft's owner. The
 * signing happens BEFORE the memo is submitted: the signed PDF is
 * persisted on the draft so the eventual /api/memos POST attaches it
 * directly instead of regenerating an unsigned PDF.
 *
 * Returns: { signingUrl, envelopeId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.email) {
      return NextResponse.json(
        { error: "Your account has no email — required for DocuSign signing." },
        { status: 400 },
      );
    }

    const { id } = await params;
    const draft = await db.memoDraft.findUnique({ where: { id } });
    if (!draft || draft.userId !== session.user.id) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Re-sign support: if the draft already has a signed PDF (e.g. user
    // edited content after the first sign), discard the previous signed
    // file + envelope fields so the new envelope binds to the latest
    // content and the composer iframe doesn't show a stale signature.
    if (draft.signedPdfPath) {
      try {
        const path = await import("path");
        const fs = await import("fs/promises");
        const abs = path.resolve(process.cwd(), draft.signedPdfPath);
        await fs.unlink(abs).catch(() => {});
      } catch {
        // best-effort cleanup
      }
      await db.memoDraft.update({
        where: { id },
        data: {
          signedPdfPath: null,
          docusignEnvelopeId: null,
          docusignStatus: null,
          docusignSignedAt: null,
        },
      });
    }

    const p = (draft.payload ?? {}) as Record<string, unknown>;
    const subject = (p.subject as string)?.trim() || draft.subject;
    const memoBody = (p.memoBody as string) ?? "";
    const memoCategory = (p.memoCategory as string) ?? "departmental";
    const department = (p.department as string) ?? "";
    const departmentOffice = (p.departmentOffice as string) ?? "";
    const designation = (p.designation as string) ?? "";

    const referencePreview = memoCategory === "personal"
      ? `KarU/PF.${(session.user.employeeId || "0000").replace(/\//g, ".")}/N`
      : `KarU/${getDepartmentMemoCode(department || "GEN")}/N`;
    const memoReference =
      (typeof p.referenceNumber === "string" && p.referenceNumber.trim()) ||
      referencePreview;

    const recipient = p.recipient as { displayName?: string; jobTitle?: string } | null;
    const toDisplay = (() => {
      if (p.toMode === "manual") return (p.manualTo as string) ?? "Recipient";
      if (recipient) {
        return [recipient.displayName, recipient.jobTitle].filter(Boolean).join(", ");
      }
      return "Recipient";
    })();

    // Prefer a client-supplied PDF rendered from the same MemoDocument
    // template the user sees in the preview — guarantees the signed PDF
    // looks identical to the electronic version. Fall back to server-
    // side generation (legacy) only if the client didn't send one.
    const reqBody = (await req.json().catch(() => ({}))) as { pdfBase64?: string };
    let pdfBytes: Uint8Array;
    if (typeof reqBody.pdfBase64 === "string" && reqBody.pdfBase64.length > 0) {
      pdfBytes = Uint8Array.from(Buffer.from(reqBody.pdfBase64, "base64"));
    } else {
      pdfBytes = await generateMemoPdf({
        memoReference,
        subject,
        body: memoBody,
        to: toDisplay,
        from: session.user.name ?? "Sender",
        fromTitle: designation,
        fromDepartment: departmentOffice || department,
        date: new Date().toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
        digitalSignatureMode: true,
      });
    }

    const baseUrl =
      process.env.APP_URL ??
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "https://edrms.karu.ac.ke";
    const returnUrl = `${baseUrl}/api/memos/drafts/${id}/docusign/return`;

    const { envelopeId, signingUrl } = await createEnvelope({
      pdfBytes,
      pdfName: `${memoReference.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
      signerEmail: session.user.email,
      signerName: session.user.name ?? "Initiator",
      emailSubject: `Sign: ${subject}`,
      embedded: true,
      clientUserId: session.user.id,
      returnUrl,
    });

    await db.memoDraft.update({
      where: { id },
      data: {
        docusignEnvelopeId: envelopeId,
        docusignStatus: "sent",
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "DRAFT_DOCUSIGN_INITIATED",
      resourceType: "memo_draft",
      resourceId: id,
      metadata: { envelopeId },
    });

    return NextResponse.json({ envelopeId, signingUrl });
  } catch (error) {
    logger.error("Failed to start draft DocuSign signing", error, {
      route: "/api/memos/drafts/[id]/docusign/sign",
    });
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
