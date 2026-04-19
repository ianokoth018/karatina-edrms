import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * POST /api/email/outbound — Send an email and track it as outgoing correspondence.
 *
 * In production, this integrates with SMTP/SendGrid/AWS SES.
 * Currently creates the correspondence record and document for tracking.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { to, subject, textBody, htmlBody, documentId, department } = body as {
      to: string;
      subject: string;
      textBody?: string;
      htmlBody?: string;
      documentId?: string; // optional link to existing document
      department?: string;
    };

    if (!to || !subject) {
      return NextResponse.json(
        { error: "to and subject are required" },
        { status: 400 }
      );
    }

    const dept = department || session.user.department || "General";

    // Register as outgoing correspondence
    const corrCount = await db.correspondence.count({
      where: {
        referenceNumber: { startsWith: `CORR/OUT/${new Date().getFullYear()}/` },
      },
    });
    const corrRef = `CORR/OUT/${new Date().getFullYear()}/${corrCount + 1}`;

    const correspondence = await db.correspondence.create({
      data: {
        type: "OUTGOING",
        referenceNumber: corrRef,
        subject,
        fromEntity: dept,
        toEntity: to,
        dateSent: new Date(),
        status: "CLOSED",
        priority: "NORMAL",
        dispatchMethod: "EMAIL",
        description: (textBody || htmlBody || "").slice(0, 500),
        documentId: documentId || undefined,
        createdById: session.user.id,
        metadata: {
          emailTo: to,
          emailSubject: subject,
          emailBody: textBody || "",
          emailHtml: htmlBody || "",
          sentBy: session.user.name,
          sentAt: new Date().toISOString(),
        },
      },
    });

    // TODO: In production, send the actual email via SMTP/SendGrid here
    // For now, we just track the correspondence record

    await writeAudit({
      userId: session.user.id,
      action: "email.outbound",
      resourceType: "Correspondence",
      resourceId: correspondence.id,
      metadata: { to, subject, corrRef },
    });

    logger.info("Outbound email tracked", {
      userId: session.user.id,
      to,
      subject,
      corrRef,
    });

    return NextResponse.json(
      {
        success: true,
        correspondenceId: correspondence.id,
        referenceNumber: corrRef,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Failed to track outbound email", error, {
      route: "/api/email/outbound",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
