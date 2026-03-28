"use client";

import { SessionProvider, signIn, useSession } from "next-auth/react";
import { useEffect } from "react";

/**
 * Watches the session for a "RefreshTokenError" and forces a re-login when
 * the refresh token has expired or rotation has failed.
 */
function SessionGuard({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === "RefreshTokenError") {
      // Redirect the user to the login page so they can re-authenticate.
      signIn(undefined, { callbackUrl: window.location.href });
    }
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
