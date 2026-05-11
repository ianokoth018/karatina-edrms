"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Silently calls update() every 10 minutes so the access token rotates
 * before the 15-minute window closes, and again whenever the tab regains
 * focus (handles device sleep / long-idle tabs).
 */
export default function SessionKeepAlive() {
  const { update } = useSession();

  useEffect(() => {
    const interval = setInterval(() => update(), 10 * 60 * 1000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") update();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [update]);

  return null;
}
