import { NextRequest, NextResponse } from "next/server";
import * as React from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { renderEmail, renderEmailText } from "@/lib/mailer";
import { getSmtpConfig } from "@/lib/settings";
import { createMemoShareToken } from "@/lib/memo-share";
import { generateMemoPdf, loadUserAssetPng } from "@/lib/memo-pdf";
import MemoCirculatedEmail from "@/emails/memo-circulated";
import nodemailer from "nodemailer";

// ---------------------------------------------------------------------------
// POST /api/memos/[id]/circulate — circulate an approved memo to users/departments.
//
// In addition to creating in-app notifications, this endpoint:
//   1. Generates a single signed share token + PDF for this memo.
//   2. Sends each recipient with an email address a branded email with:
//        - the precise circulator message
//        - the memo PDF as an attachment
//        - public view + download links (no login required)
//        - a deep link into the EDRMS for logged-in users
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { userIds, departments, message } = (await req.json()) as {
      userIds?: string[];
      departments?: string[];
      message?: string;
    };

    if (
      (!userIds || userIds.length === 0) &&
      (!departments || departments.length === 0)
    ) {
      return NextResponse.json(
        { error: "Select at least one user or department" },
        { status: 400 }
      );
    }

    // Fetch the memo with everything needed for the PDF + email
    const memo = await db.workflowInstance.findUnique({
      where: { id },
      include: {
        document: {
          select: {
            referenceNumber: true,
            title: true,
            description: true,
            metadata: true,
          },
        },
        tasks: {
          orderBy: { stepIndex: "asc" },
          include: {
            assignee: {
              select: { displayName: true, name: true, jobTitle: true },
            },
          },
        },
      },
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    // Resolve recipients
    const recipientIds = new Set<string>(userIds ?? []);
    if (departments && departments.length > 0) {
      const deptUsers = await db.user.findMany({
        where: { isActive: true, department: { in: departments } },
        select: { id: true },
      });
      for (const u of deptUsers) recipientIds.add(u.id);
    }
    recipientIds.delete(session.user.id);

    if (recipientIds.size === 0) {
      return NextResponse.json({ error: "No recipients found" }, { status: 400 });
    }

    const formData = (memo.formData as Record<string, unknown>) ?? {};
    const meta = (memo.document?.metadata as Record<string, unknown>) ?? {};
    const memoRef =
      memo.document?.referenceNumber ??
      (formData?.memoReference as string) ??
      memo.referenceNumber;

    // Build PDF bytes once — same attachment for every recipient
    const subject = memo.subject ?? memo.document?.title ?? "Memorandum";
    const bodyHtml =
      (formData.body as string) ??
      (meta.bodyHtml as string) ??
      (memo.document?.description ?? "");
    const fromName =
      (formData.fromName as string) ?? (meta.from as string) ?? "Sender";
    const approverTask = memo.tasks.find(
      (t) => t.stepName === "Final Approval" && t.action === "APPROVED"
    );
    const approvedByName =
      approverTask?.assignee?.displayName ?? approverTask?.assignee?.name;
    const approvedAt = approverTask?.completedAt
      ? new Date(approverTask.completedAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : undefined;

    // The signature on a memo belongs to the INITIATOR (the person it's
    // from), not the approver — that matches how official Karatina memos
    // are signed. Approvers acknowledge in the "APPROVED" strip below.
    const formDataInitiatorId = (formData.fromId as string | undefined) ?? null;
    const signerUserId = formDataInitiatorId ?? memo.initiatedById;
    const signer = signerUserId
      ? await db.user.findUnique({
          where: { id: signerUserId },
          select: { signatureImage: true, officeStamp: true },
        })
      : null;
    const [approverSignaturePng, approverStampPng] = await Promise.all([
      loadUserAssetPng(signer?.signatureImage),
      loadUserAssetPng(signer?.officeStamp),
    ]);

    const pdfBytes = await generateMemoPdf({
      memoReference: memoRef,
      workflowReference: memo.referenceNumber,
      subject,
      body: bodyHtml,
      to: (formData.toName as string) ?? (meta.to as string) ?? "Recipient",
      from: fromName,
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
      approvedByName,
      approvedByTitle: approverTask?.assignee?.jobTitle ?? undefined,
      approvedAt,
      approverSignaturePng,
      approverStampPng,
    });

    // Public share token + URLs
    const token = createMemoShareToken(memo.id);
    const baseUrl =
      process.env.APP_URL ??
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "https://edrms.karu.ac.ke";
    const viewUrl = `${baseUrl}/api/memos/public/${token}`;
    const downloadUrl = `${viewUrl}?download=1`;
    const systemUrl = `${baseUrl}/memos/${memo.id}`;
    const safeFilename = `${memoRef.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

    // Hydrate recipient details (we need email + display name)
    const recipients = await db.user.findMany({
      where: { id: { in: Array.from(recipientIds) } },
      select: { id: true, name: true, displayName: true, email: true, jobTitle: true },
    });

    const circulatedBy = await db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, displayName: true, jobTitle: true, department: true },
    });

    // Create in-app notifications (existing behaviour preserved)
    await db.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        type: "MEMO_CIRCULATED",
        title: `Memo Circulated: ${subject}`,
        body: message
          ? `${session.user!.name} circulated memo "${subject}" (${memoRef}): ${message}`
          : `${session.user!.name} circulated memo "${subject}" (${memoRef}) for your information.`,
        linkUrl: `/memos/${memo.id}`,
      })),
    });

    // Send branded emails with the PDF attached.
    // Use a transport directly so we can add the attachment in one place.
    let emailsSent = 0;
    const emailRecipients = recipients.filter((r) => r.email);

    const smtpCfg = await getSmtpConfig();
    if (emailRecipients.length > 0 && smtpCfg) {
      const transport = nodemailer.createTransport({
        host: smtpCfg.host,
        port: smtpCfg.port,
        secure: smtpCfg.secure,
        auth:
          smtpCfg.user && smtpCfg.password
            ? { user: smtpCfg.user, pass: smtpCfg.password }
            : undefined,
      });
      const fromHeader = smtpCfg.fromAddress;

      const pdfAttachment = {
        filename: safeFilename,
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      };

      for (const recipient of emailRecipients) {
        try {
          const reactEl = React.createElement(MemoCirculatedEmail, {
            recipientName: recipient.displayName ?? recipient.name ?? "Colleague",
            circulatedByName:
              circulatedBy?.displayName ?? circulatedBy?.name ?? session.user!.name ?? "A colleague",
            circulatedByTitle:
              circulatedBy?.jobTitle ?? circulatedBy?.department ?? undefined,
            memoReference: memoRef,
            workflowReference: memo.referenceNumber,
            subject,
            message: message ?? undefined,
            fromName,
            approvedByName,
            approvedAt,
            viewUrl,
            downloadUrl,
            systemUrl,
          });
          const html = await renderEmail(reactEl);
          const text = await renderEmailText(reactEl);

          await transport.sendMail({
            from: fromHeader,
            to: recipient.email!,
            subject: `Memo for your information: ${subject}`,
            html,
            text,
            attachments: [pdfAttachment],
          });
          emailsSent += 1;
        } catch (err) {
          logger.error("Failed to deliver circulation email", err, {
            recipientId: recipient.id,
            memoId: memo.id,
          });
        }
      }
    } else if (emailRecipients.length > 0 && !smtpCfg) {
      logger.warn("SMTP not configured — skipping circulation emails", {
        memoId: memo.id,
        skippedRecipients: emailRecipients.length,
      });
    }

    // Workflow event
    await db.workflowEvent.create({
      data: {
        instanceId: memo.id,
        eventType: "MEMO_CIRCULATED",
        actorId: session.user.id,
        data: {
          actorName: session.user.name,
          recipientCount: recipientIds.size,
          emailsSent,
          departments: departments ?? [],
          userCount: userIds?.length ?? 0,
          message: message ?? null,
          shareToken: token,
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "MEMO_CIRCULATE",
      resourceType: "workflow_instance",
      resourceId: memo.id,
      metadata: {
        recipientCount: recipientIds.size,
        emailsSent,
        departments: departments ?? [],
      },
    });

    return NextResponse.json({
      success: true,
      recipientCount: recipientIds.size,
      emailsSent,
    });
  } catch (error) {
    logger.error("Failed to circulate memo", error, {
      route: "/api/memos/[id]/circulate",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
