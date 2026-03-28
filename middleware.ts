import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Protect all routes except /login and /api/auth.
 * Unauthenticated users are redirected to /login.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow public routes through without authentication
  const isPublicRoute =
    pathname === "/login" ||
    pathname.startsWith("/api/auth");

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Match all routes except static assets and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
