import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateReference } from "@/lib/reference";
import { getDepartmentCode } from "@/lib/departments";
import { logger } from "@/lib/logger";

/**
 * POST /api/email/inbound — Webhook receiver for incoming emails.
 *
 * In production, this would be called by an email service (SendGrid Inbound Parse,
 * AWS SES, Mailgun Routes, etc.) when an email is received at the EDRMS inbox.
 *
 * For now, it also accepts manual submissions from the admin UI.
 *
 * Headers: x-api-key for webhook auth, or session auth for manual submissions.
 */
export async function POST(req: NextRequest) {
  try {
    // Auth: either API key (webhook) or session (manual)
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.EMAIL_INBOUND_API_KEY;

    let createdById: string | null = null;

    if (apiKey && expectedKey && apiKey === expectedKey) {
      // Webhook auth — use a system user
      const systemUser = await db.user.findFirst({
        where: { email: "admin@karu.ac.ke" },
        select: { id: true },
      });
      createdById = systemUser?.id ?? null;
    } else {
      // Session auth
      const { auth } = await import("@/lib/auth");
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      createdById = session.user.id;
    }

    if (!createdById) {
      return NextResponse.json({ error: "No system user found" }, { status: 500 });
    }

    const body = await req.json();
    const {
      from,
      to,
      subject,
      textBody,
      htmlBody,
      date,
      department,
      attachments,
    } = body as {
      from: string;
      to: string;
      subject: string;
      textBody?: string;
      htmlBody?: string;
      date?: string;
      department?: string;
      attachments?: { fileName: string; mimeType: string; sizeBytes: number; storagePath: string }[];
    };

    if (!from || !subject) {
      return NextResponse.json(
        { error: "from and subject are required" },
        { status: 400 }
      );
    }

    const dept = department || "Registry (Records)";
    const deptCode = getDepartmentCode(dept);
    const referenceNumber = await generateReference("EMAIL", deptCode);

    // Create a Document record from the email
    const document = await db.document.create({
      data: {
        referenceNumber,
        title: subject,
        description: (textBody || "").slice(0, 500),
        documentType: "EMAIL",
        department: dept,
        createdById,
        status: "ACTIVE",
        sourceSystem: "EMAIL",
        metadata: {
          emailFrom: from,
          emailTo: to,
          emailDate: date || new Date().toISOString(),
          emailSubject: subject,
          emailBody: textBody || "",
          emailHtml: htmlBody || "",
          attachmentCount: attachments?.length || 0,
        },
      },
    });

    // Create file records for attachments
    if (attachments?.length) {
      for (const att of attachments) {
        await db.documentFile.create({
          data: {
            documentId: document.id,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: BigInt(att.sizeBytes),
            storagePath: att.storagePath,
          },
        });
      }
    }

    // Also register as incoming correspondence
    const corrCount = await db.correspondence.count({
      where: {
        referenceNumber: { startsWith: `CORR/IN/${new Date().getFullYear()}/` },
      },
    });
    const corrRef = `CORR/IN/${new Date().getFullYear()}/${corrCount + 1}`;

    await db.correspondence.create({
      data: {
        type: "INCOMING",
        referenceNumber: corrRef,
        subject,
        fromEntity: from,
        toEntity: to || dept,
        dateReceived: date ? new Date(date) : new Date(),
        status: "PENDING",
        priority: "NORMAL",
        dispatchMethod: "EMAIL",
        description: (textBody || "").slice(0, 500),
        documentId: document.id,
        createdById,
      },
    });

    await writeAudit({
      userId: createdById,
      action: "email.inbound",
      resourceType: "Document",
      resourceId: document.id,
      metadata: { from, subject, referenceNumber },
    });

    logger.info("Inbound email processed", {
      documentId: document.id,
      from,
      subject,
    });

    return NextResponse.json(
      { success: true, documentId: document.id, referenceNumber },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Failed to process inbound email", error, {
      route: "/api/email/inbound",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
