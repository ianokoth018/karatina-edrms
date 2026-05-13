import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import {
  getNitroConfigSafe,
  setNitroConfig,
  type NitroConfig,
} from "@/lib/settings";
import { resetTokenCache } from "@/lib/nitro";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const cfg = await getNitroConfigSafe();
    return NextResponse.json(cfg);
  } catch (error) {
    logger.error("Failed to load Nitro Sign settings", error, {
      route: "/api/admin/settings/nitro GET",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as Partial<NitroConfig>;
    const clientId = (body.clientId ?? "").trim();
    const environment: NitroConfig["environment"] =
      body.environment === "production" ? "production" : "sandbox";
    const oauthTokenUrl =
      (body.oauthTokenUrl ?? "").trim() ||
      (environment === "production"
        ? "https://api.gonitro.com/oauth/token"
        : "https://api.sandbox.gonitro.com/oauth/token");
    const apiBaseUrl =
      (body.apiBaseUrl ?? "").trim() ||
      (environment === "production"
        ? "https://api.gonitro.com/sign/v2"
        : "https://api.sandbox.gonitro.com/sign/v2");

    if (!clientId) {
      return NextResponse.json(
        { error: "Client ID is required." },
        { status: 400 },
      );
    }

    await setNitroConfig(
      {
        clientId,
        environment,
        oauthTokenUrl,
        apiBaseUrl,
        clientSecret: body.clientSecret ?? "",
        webhookSecret: body.webhookSecret ?? "",
        enabled: !!body.enabled,
      },
      session.user.id,
    );

    // Saved credentials may differ from whatever a cached token was minted
    // against — clear the cache so the next request mints fresh.
    resetTokenCache();

    await writeAudit({
      userId: session.user.id,
      action: "admin.nitro_settings_updated",
      resourceType: "AppSetting",
      resourceId: "nitro",
      metadata: {
        clientId,
        environment,
        clientSecretChanged: !!(body.clientSecret && body.clientSecret.trim()),
        webhookSecretChanged: !!(
          body.webhookSecret && body.webhookSecret.trim()
        ),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to save Nitro Sign settings", error, {
      route: "/api/admin/settings/nitro PUT",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
