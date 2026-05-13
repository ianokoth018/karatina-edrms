import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { sendTestShipment, siemEnabled } from "@/lib/siem";

/**
 * POST /api/admin/siem/test
 *
 * Writes a synthetic audit row tagged `siem.test_shipment`, then
 * immediately attempts to ship it.  Admins use this to validate
 * end-to-end connectivity to the configured SIEM after changing env
 * vars (Splunk URL, syslog host, etc.) without having to wait for a
 * real audit event.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (!siemEnabled()) {
      return NextResponse.json({
        ok: false,
        error: "SIEM_TARGET not configured",
      });
    }
    const result = await sendTestShipment(session.user.id as string | undefined);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("SIEM test endpoint failed", error, {
      route: "/api/admin/siem/test",
    });
    const message = error instanceof Error ? error.message : "Test failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
