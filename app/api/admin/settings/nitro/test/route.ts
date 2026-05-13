import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { getAccessToken } from "@/lib/nitro";

/**
 * POST /api/admin/settings/nitro/test
 *
 * Exchanges the client-credentials grant and probes the Sign API root
 * so the admin sees "Connected" or the precise error from Nitro.
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
      const { token, apiBaseUrl } = await getAccessToken();
      // Lightweight account/ping probe — Nitro exposes `/account` under the
      // Sign v2 base. If that route is renamed, we still treat a successful
      // token exchange as "configured but unable to reach the account
      // endpoint" so admins can troubleshoot.
      const probe = await fetch(`${apiBaseUrl}/account`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const ok = probe.ok;
      const data = ok ? await probe.json().catch(() => null) : null;

      await writeAudit({
        userId: session.user.id,
        action: "admin.nitro_connection_tested",
        resourceType: "AppSetting",
        resourceId: "nitro",
        metadata: { ok, status: probe.status },
      });

      if (!ok) {
        const text = await probe.text().catch(() => "");
        return NextResponse.json(
          {
            connected: false,
            error: `Account probe failed (${probe.status}): ${text || probe.statusText}`,
          },
          { status: 200 },
        );
      }
      return NextResponse.json({
        connected: true,
        accountName:
          (data as { accountName?: string; name?: string } | null)?.accountName ??
          (data as { accountName?: string; name?: string } | null)?.name ??
          null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      return NextResponse.json(
        { connected: false, error: msg },
        { status: 200 },
      );
    }
  } catch (error) {
    logger.error("Nitro Sign test endpoint failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
