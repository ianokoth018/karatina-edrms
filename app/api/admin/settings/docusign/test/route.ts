import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { getAccessToken } from "@/lib/docusign";

/**
 * POST /api/admin/settings/docusign/test
 *
 * Calls the JWT exchange and returns "Connected" or the precise error
 * message from DocuSign so the admin can troubleshoot quickly.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const { token, accountId, basePath } = await getAccessToken();
      // Probe the user's account info as a sanity check beyond just JWT.
      const probe = await fetch(
        `${basePath.replace("/restapi", "")}/restapi/v2.1/accounts/${accountId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const ok = probe.ok;
      const body = ok ? await probe.json().catch(() => null) : null;

      await writeAudit({
        userId: session.user.id,
        action: "admin.docusign_connection_tested",
        resourceType: "AppSetting",
        resourceId: "docusign",
        metadata: { ok, status: probe.status },
      });

      if (!ok) {
        const text = await probe.text().catch(() => "");
        return NextResponse.json(
          { connected: false, error: `Account probe failed: ${text || probe.statusText}` },
          { status: 200 },
        );
      }
      return NextResponse.json({
        connected: true,
        accountName: body?.accountName ?? null,
        baseUri: body?.baseUri ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      return NextResponse.json({ connected: false, error: msg }, { status: 200 });
    }
  } catch (error) {
    logger.error("DocuSign test endpoint failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
