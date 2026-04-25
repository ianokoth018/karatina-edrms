import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import {
  getDocusignConfigSafe,
  setDocusignConfig,
  type DocusignConfig,
} from "@/lib/settings";

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
    const cfg = await getDocusignConfigSafe();
    return NextResponse.json(cfg);
  } catch (error) {
    logger.error("Failed to load DocuSign settings", error, {
      route: "/api/admin/settings/docusign GET",
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

    const body = (await req.json()) as Partial<DocusignConfig>;
    const integrationKey = (body.integrationKey ?? "").trim();
    const accountId = (body.accountId ?? "").trim();
    const impersonationUserId = (body.impersonationUserId ?? "").trim();
    const oauthBasePath: DocusignConfig["oauthBasePath"] =
      body.oauthBasePath === "account.docusign.com"
        ? "account.docusign.com"
        : "account-d.docusign.com";
    const restBasePath = (body.restBasePath ?? "").trim() ||
      (oauthBasePath === "account.docusign.com"
        ? "https://www.docusign.net/restapi"
        : "https://demo.docusign.net/restapi");

    if (!integrationKey || !accountId || !impersonationUserId) {
      return NextResponse.json(
        { error: "Integration key, account ID and impersonation user are required." },
        { status: 400 },
      );
    }

    await setDocusignConfig(
      {
        integrationKey,
        accountId,
        impersonationUserId,
        oauthBasePath,
        restBasePath,
        privateKey: body.privateKey ?? "",
        enabled: !!body.enabled,
      },
      session.user.id,
    );

    await writeAudit({
      userId: session.user.id,
      action: "admin.docusign_settings_updated",
      resourceType: "AppSetting",
      resourceId: "docusign",
      metadata: {
        accountId,
        impersonationUserId,
        environment: oauthBasePath === "account.docusign.com" ? "production" : "demo",
        privateKeyChanged: !!(body.privateKey && body.privateKey.trim()),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to save DocuSign settings", error, {
      route: "/api/admin/settings/docusign PUT",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
