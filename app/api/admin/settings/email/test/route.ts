import { NextRequest, NextResponse } from "next/server";
import * as React from "react";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { getSmtpConfig } from "@/lib/settings";
import WorkflowNotification from "@/emails/workflow-notification";

/**
 * POST /api/admin/settings/email/test — send a branded test email using the
 * currently saved SMTP config. Admin-only.
 *
 * Body: { to: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { to } = (await req.json()) as { to?: string };
    if (!to || !to.includes("@")) {
      return NextResponse.json(
        { error: "A valid recipient email is required" },
        { status: 400 },
      );
    }

    const cfg = await getSmtpConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: "SMTP is not configured yet — fill in and save the settings first." },
        { status: 400 },
      );
    }

    const ok = await sendMail({
      to,
      subject: "EDRMS test email — your SMTP settings work",
      react: React.createElement(WorkflowNotification, {
        recipientName: session.user.name ?? "Administrator",
        subject: "Your SMTP configuration is working",
        body: `This is a test email triggered from the Email Settings page by <strong>${session.user.name ?? "an administrator"}</strong>. If you can read this, it means the EDRMS can deliver mail through <strong>${cfg.host}:${cfg.port}</strong> as <strong>${cfg.user || "(no auth)"}</strong>. You're good to go.`,
        metadata: [
          { label: "SMTP host", value: `${cfg.host}:${cfg.port}` },
          { label: "Encryption", value: cfg.secure ? "SSL/TLS" : "STARTTLS / plain" },
          { label: "Sent at", value: new Date().toLocaleString("en-GB") },
        ],
      }),
    });

    if (!ok) {
      return NextResponse.json(
        { error: "SMTP send failed — check the server logs for details." },
        { status: 502 },
      );
    }

    await writeAudit({
      userId: session.user.id,
      action: "admin.smtp_test_sent",
      resourceType: "AppSetting",
      resourceId: "smtp",
      metadata: { to, host: cfg.host },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to send SMTP test email", error, {
      route: "/api/admin/settings/email/test",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
