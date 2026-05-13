import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/sso/probe
 *
 * Admin-gated. Fetches the configured OIDC issuer's discovery document
 * (`.well-known/openid-configuration`) and reports whether the IdP is
 * reachable and well-formed. Returns:
 *   { ok: true,  issuer, endpoints: {...} }   when discovery succeeds
 *   { ok: false, error }                      otherwise
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) {
      return NextResponse.json(
        { ok: false, error: "OIDC_ISSUER is not set" },
        { status: 200 }
      );
    }

    const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : "Network error";
      return NextResponse.json(
        { ok: false, error: `Could not reach ${url}: ${msg}` },
        { status: 200 }
      );
    }
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Discovery returned HTTP ${res.status} from ${url}` },
        { status: 200 }
      );
    }

    const doc = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object") {
      return NextResponse.json(
        { ok: false, error: "Discovery document is not valid JSON" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      issuer: doc.issuer ?? issuer,
      endpoints: {
        authorization_endpoint: doc.authorization_endpoint ?? null,
        token_endpoint: doc.token_endpoint ?? null,
        userinfo_endpoint: doc.userinfo_endpoint ?? null,
        jwks_uri: doc.jwks_uri ?? null,
        end_session_endpoint: doc.end_session_endpoint ?? null,
      },
    });
  } catch (error) {
    logger.error("SSO probe failed", error, { route: "/api/admin/sso/probe" });
    return NextResponse.json({ error: "Probe failed" }, { status: 500 });
  }
}
