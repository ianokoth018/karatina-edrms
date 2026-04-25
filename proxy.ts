import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Protect all routes except /login and /api/auth.
 * Uses next-auth/jwt which is Edge Runtime compatible (no Node.js crypto).
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  const isPublicRoute =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/integration") ||
    // Circulated memos: signed-token endpoint, no account required
    pathname.startsWith("/api/memos/public/") ||
    // Document share links: token already authenticates
    pathname.startsWith("/api/shared/") ||
    // DocuSign Connect webhook — vendor signs the request
    pathname === "/api/docusign/webhook" ||
    // DocuSign embedded-signing return URLs — hit by the popup after
    // signing. Calling auth() inside these races with the parent
    // window's JWT refresh and corrupts the cookie. Verified via
    // envelope ID server-side instead of session.
    /^\/api\/memos\/drafts\/[^/]+\/docusign\/return$/.test(pathname) ||
    /^\/api\/memos\/[^/]+\/docusign\/return$/.test(pathname);

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Check JWT token (Edge-compatible)
  // NextAuth v5 uses "authjs" cookie prefix, not "next-auth"
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    cookieName: req.nextUrl.protocol === "https:"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Force a password change before any other navigation when an admin has
  // initiated a reset. Allow only the change-password page itself, the
  // sign-out endpoint, and the change-password API.
  if (token.mustChangePassword) {
    const allowedDuringForcedReset =
      pathname === "/change-password" ||
      pathname.startsWith("/api/auth/change-password") ||
      pathname.startsWith("/api/auth/signout") ||
      pathname.startsWith("/api/auth/session");
    if (!allowedDuringForcedReset) {
      return NextResponse.redirect(new URL("/change-password", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
