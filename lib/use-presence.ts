"use client";

import { useEffect, useState } from "react";

/**
 * Client-side presence hook.
 *
 * While mounted, posts a heartbeat to `/api/presence/heartbeat` every 10s
 * (also on mount and on `visibilitychange` to "visible") and polls
 * `/api/presence` on the same cadence to refresh the viewer list.
 *
 * No WebSockets, no push — pure poll. Cadence is fixed at 10s to keep
 * the server load bounded.
 */

export interface PresenceUser {
  id: string;
  displayName: string;
  initials: string;
  lastSeenAt: string;
}

const HEARTBEAT_INTERVAL_MS = 10_000;

export function usePresence(
  resourceType: string,
  resourceId: string,
): { viewers: PresenceUser[]; loading: boolean } {
  const [viewers, setViewers] = useState<PresenceUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!resourceType || !resourceId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const heartbeat = async () => {
      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceType, resourceId }),
          cache: "no-store",
        });
      } catch {
        /* swallow — heartbeats are best-effort */
      }
    };

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/presence?resourceType=${encodeURIComponent(
            resourceType,
          )}&resourceId=${encodeURIComponent(resourceId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { viewers?: PresenceUser[] };
        if (cancelled) return;
        setViewers(data.viewers ?? []);
      } catch {
        /* swallow — next tick will retry */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const tick = () => {
      void heartbeat();
      void poll();
    };

    // Fire immediately on mount.
    tick();

    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resourceType, resourceId]);

  return { viewers, loading };
}
