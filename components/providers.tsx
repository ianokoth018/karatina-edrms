"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { useEffect } from "react";

/**
 * Watches the session for a "RefreshTokenError" and forces a re-login when
 * the refresh token has expired or rotation has failed.
 *
 * We navigate directly to /login (our custom page) and pass the current
 * pathname as callbackUrl. We deliberately do NOT use NextAuth's
 * `signIn(undefined, ...)` here because that hits its default `/api/auth/signin`
 * page, and when window.location.href already contains a `callbackUrl=` query
 * (because the proxy redirected us once), the parameter gets nested into
 * itself and produces an infinite redirect loop.
 */
function SessionGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error !== "RefreshTokenError") return;
    if (typeof window === "undefined") return;
    const currentPath = window.location.pathname;
    // Don't bounce when we're already on the login page.
    if (currentPath === "/login") return;
    const params = new URLSearchParams({ callbackUrl: currentPath });
    window.location.href = `/login?${params.toString()}`;
  }, [session?.error]);

  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Re-fetch the session every 4 minutes so the client discovers an
      // expired access token before the 15-minute window fully elapses.
      refetchInterval={4 * 60}
      refetchOnWindowFocus={true}
    >
      <SessionGuard>{children}</SessionGuard>
    </SessionProvider>
  );
}
