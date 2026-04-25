import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateMemoPdf } from "@/lib/memo-pdf";
import { createEnvelope } from "@/lib/docusign";

/**
 * POST /api/memos/[id]/docusign/sign
 *
 * Generates the memo PDF and creates a DocuSign envelope addressed to the
 * memo's *initiator* — DocuSign signing is initiator-owned (the same person
 * whose electronic signature is embedded), not per-approver. Signing claims
 * cryptographic ownership of the memo before it routes for approval.
 *
 * Returns an embedded-signing URL for an in-app modal. After signing,
 * DocuSign redirects to /api/memos/[id]/docusign/return which downloads
 * the signed PDF and stores it on the WorkflowInstance.
 */
export async function POST(
  _req: NextRequest,
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

    const memo = await db.workflowInstance.findUnique({
      where: { id },
      include: { document: true },
    });
    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }
    if (memo.initiatedById !== session.user.id) {
      return NextResponse.json(
        { error: "Only the memo initiator can sign with DocuSign." },
        { status: 403 },
      );
    }
    if (memo.docusignSignedAt && memo.docusignSignedPdf) {
      return NextResponse.json(
        { error: "This memo has already been digitally signed." },
        { status: 400 },
      );
    }

    const formData = (memo.formData as Record<string, unknown>) ?? {};
    const meta = (memo.document?.metadata as Record<string, unknown>) ?? {};
    const memoRef =
      memo.document?.referenceNumber ??
      (formData.memoReference as string) ??
      memo.referenceNumber;
    const subject = memo.subject ?? memo.document?.title ?? "Memorandum";
    const bodyHtml =
      (formData.body as string) ??
      (meta.bodyHtml as string) ??
      memo.document?.description ?? "";

    const pdfBytes = await generateMemoPdf({
      memoReference: memoRef,
      workflowReference: memo.referenceNumber,
      subject,
      body: bodyHtml,
      to: (formData.toName as string) ?? (meta.to as string) ?? "Recipient",
      from: (formData.fromName as string) ?? (meta.from as string) ?? "Sender",
      fromTitle:
        (formData.fromJobTitle as string) ?? (meta.designation as string) ?? "",
      fromDepartment:
        (formData.fromDepartment as string) ??
        (meta.departmentOffice as string) ??
        (meta.department as string) ??
        "",
      cc: (meta.copy_to as string) ?? "",
      date: new Date(memo.startedAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      // Digital-signature mode: skip electronic sig + typed name, keep
      // only department; DocuSign's signature box carries the identity.
      digitalSignatureMode: true,
    });

    const baseUrl =
      process.env.APP_URL ??
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "https://edrms.karu.ac.ke";
    const returnUrl = `${baseUrl}/api/memos/${id}/docusign/return`;

    const { envelopeId, signingUrl } = await createEnvelope({
      pdfBytes,
      pdfName: `${memoRef.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
      signerEmail: session.user.email,
      signerName: session.user.name ?? "Initiator",
      emailSubject: `Sign: ${subject}`,
      embedded: true,
      clientUserId: session.user.id,
      returnUrl,
    });

    await db.workflowInstance.update({
      where: { id },
      data: {
        docusignEnvelopeId: envelopeId,
        docusignStatus: "sent",
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "MEMO_DOCUSIGN_INITIATED",
      resourceType: "workflow_instance",
      resourceId: id,
      metadata: { envelopeId },
    });

    return NextResponse.json({ envelopeId, signingUrl });
  } catch (error) {
    logger.error("Failed to start DocuSign signing", error, {
      route: "/api/memos/[id]/docusign/sign",
    });
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
