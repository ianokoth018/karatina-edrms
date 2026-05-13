import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { parseSamlResponse, samlEnabled } from "@/lib/saml";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/saml/acs — Assertion Consumer Service.
 *
 * The IdP form-POSTs the signed SAMLResponse here. We:
 *   1. Verify the assertion signature + issuer via samlify.
 *   2. Extract email / displayName / groups from the assertion.
 *   3. Hand the pre-verified pair to NextAuth's "saml" Credentials
 *      provider — that provider find-or-creates the User row and mints
 *      the session cookie. We return the redirect-to-/dashboard response
 *      from NextAuth so the Set-Cookie header is preserved on the way
 *      back to the browser.
 *
 * On any failure (signature mismatch, missing email, etc.) we redirect
 * the user back to /login with an error query string rather than 500ing.
 */
export async function POST(req: NextRequest) {
  if (!samlEnabled()) {
    return NextResponse.json(
      { error: "SAML is not configured on this server" },
      { status: 503 },
    );
  }

  let email: string;
  let displayName: string;
  try {
    const form = await req.formData();
    const samlResponse = form.get("SAMLResponse");
    if (typeof samlResponse !== "string" || !samlResponse) {
      throw new Error("Missing SAMLResponse");
    }
    const parsed = await parseSamlResponse(samlResponse);
    email = parsed.email;
    displayName = parsed.displayName;
  } catch (error) {
    logger.error("SAML ACS verification failed", error, {
      route: "/api/auth/saml/acs",
    });
    return NextResponse.redirect(new URL("/login?error=saml", req.url), {
      status: 302,
    });
  }

  // Mint the NextAuth session via the trusted "saml" provider. Passing
  // redirectTo lets NextAuth set the cookie and 302 the browser to the
  // dashboard in a single round-trip.
  try {
    await signIn("saml", {
      email,
      name: displayName,
      redirectTo: "/dashboard",
    });
    // Unreachable in practice — signIn throws a NEXT_REDIRECT internally
    // which the runtime turns into the redirect response.
    return NextResponse.redirect(new URL("/dashboard", req.url), {
      status: 302,
    });
  } catch (error) {
    // NextAuth signals redirects by throwing a special error; let it
    // propagate so the framework can convert it to a 3xx with the
    // Set-Cookie attached.
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
        (error as { digest: string }).digest.includes("REDIRECT"))
    ) {
      throw error;
    }
    logger.error("SAML signIn failed after verified assertion", error, {
      route: "/api/auth/saml/acs",
      email,
    });
    return NextResponse.redirect(new URL("/login?error=saml-signin", req.url), {
      status: 302,
    });
  }
}
