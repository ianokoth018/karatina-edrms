import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { getSmtpConfigSafe, setSmtpConfig } from "@/lib/settings";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

/**
 * GET /api/admin/settings/email — return masked SMTP config + source.
 * Admin-only. Never returns the raw password.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cfg = await getSmtpConfigSafe();
    return NextResponse.json(cfg);
  } catch (error) {
    logger.error("Failed to load SMTP settings", error, {
      route: "/api/admin/settings/email",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/settings/email — persist SMTP config.
 * Admin-only. Password is encrypted at rest. An empty password keeps the
 * existing one untouched.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      host?: string;
      port?: number | string;
      secure?: boolean;
      user?: string;
      password?: string;
      fromAddress?: string;
    };

    const host = (body.host ?? "").trim();
    if (!host) {
      return NextResponse.json({ error: "SMTP host is required" }, { status: 400 });
    }
    const port = Number(body.port ?? 587);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: "Invalid SMTP port" }, { status: 400 });
    }

    await setSmtpConfig(
      {
        host,
        port,
        secure: !!body.secure,
        user: (body.user ?? "").trim(),
        password: body.password ?? "",
        fromAddress:
          (body.fromAddress ?? "").trim() ||
          `"Karatina University EDRMS" <noreply@${host}>`,
      },
      session.user.id,
    );

    await writeAudit({
      userId: session.user.id,
      action: "admin.smtp_settings_updated",
      resourceType: "AppSetting",
      resourceId: "smtp",
      metadata: {
        host,
        port,
        secure: !!body.secure,
        passwordChanged: !!(body.password && body.password.trim()),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to save SMTP settings", error, {
      route: "/api/admin/settings/email",
      method: "PUT",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
