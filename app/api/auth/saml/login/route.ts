import { NextResponse } from "next/server";
import { getLoginRedirectUrl, samlEnabled } from "@/lib/saml";
import { logger } from "@/lib/logger";

/**
 * GET /api/auth/saml/login — SP-initiated SAML sign-in entry point.
 *
 * Builds a fresh AuthnRequest, encodes it onto the IdP's
 * HTTP-Redirect SSO endpoint, and 302s the browser there. The IdP
 * authenticates the user and POSTs the SAMLResponse back to /acs.
 */
export async function GET() {
  if (!samlEnabled()) {
    return NextResponse.json(
      { error: "SAML is not configured on this server" },
      { status: 503 },
    );
  }
  try {
    const url = getLoginRedirectUrl();
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    logger.error("saml login redirect failed", error, {
      route: "/api/auth/saml/login",
    });
    return NextResponse.json(
      { error: "Failed to build SAML AuthnRequest" },
      { status: 500 },
    );
  }
}
