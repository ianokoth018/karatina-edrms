import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { testLdapConnection } from "@/lib/ldap";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/ldap/test
 *
 * Admin-gated connectivity probe. Performs a service-account bind and a
 * trivial paged search to confirm:
 *   - the URL is reachable,
 *   - TLS (for ldaps://) negotiates,
 *   - the service account can authenticate,
 *   - the configured user search base actually contains entries.
 *
 * Always returns HTTP 200 with an `{ ok, error?, userCount? }` body so
 * the UI never needs to parse the status code — it just renders the
 * payload.
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

    const result = await testLdapConnection();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("LDAP test endpoint failed", error, { route: "/api/admin/ldap/test" });
    const message = error instanceof Error ? error.message : "Probe failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
