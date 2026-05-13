"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export type RealtimeStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface UseRealtimeDoc {
  ydoc: Y.Doc | null;
  provider: WebsocketProvider | null;
  status: RealtimeStatus;
}

/**
 * Mount a Yjs document bound to a y-websocket room.
 *
 * The hook posts to `/api/realtime/token` to mint a room-scoped HMAC token,
 * then connects to the WebSocket URL returned by the server. The Y.Doc is
 * created lazily on first connect and destroyed on unmount (or when `room`
 * changes), so callers get a stable, room-scoped document they can bind
 * editors / shared types to.
 *
 * Server URLs:
 *   - Token endpoint: same-origin `/api/realtime/token`
 *   - WebSocket: `NEXT_PUBLIC_REALTIME_URL` (set on the API server too)
 *
 * Usage:
 *   const { ydoc, status } = useRealtimeDoc(`memo:${memoId}`);
 *   useEffect(() => { if (!ydoc) return; const text = ydoc.getText("body"); ... }, [ydoc]);
 */
export function useRealtimeDoc(room: string | null | undefined): UseRealtimeDoc {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  // Track the latest "intended" room so a slow token-fetch for an old room
  // can't accidentally connect after the caller moved on.
  const requestedRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room) {
      setYdoc(null);
      setProvider(null);
      setStatus("disconnected");
      return;
    }

    let cancelled = false;
    requestedRoomRef.current = room;
    setStatus("connecting");

    const doc = new Y.Doc();
    let prov: WebsocketProvider | null = null;

    (async () => {
      try {
        const res = await fetch("/api/realtime/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
        if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);

        const json = (await res.json()) as {
          wsUrl?: string;
          token?: string;
          expiresAt?: number;
        };
        if (cancelled || requestedRoomRef.current !== room) return;
        if (!json.wsUrl || !json.token) throw new Error("malformed token payload");

        // wsUrl is `${BASE}/${room}?token=${token}` — split back into
        // (base, roomName, params) since WebsocketProvider builds the URL
        // itself from (serverUrl, roomname, doc, { params }).
        const wsUrlObj = new URL(json.wsUrl);
        // pathname is `/${encodeURIComponent(room)}` — strip the leading slash.
        const roomName = decodeURIComponent(wsUrlObj.pathname.replace(/^\//, ""));
        const serverUrl = `${wsUrlObj.protocol}//${wsUrlObj.host}`;

        prov = new WebsocketProvider(serverUrl, roomName, doc, {
          params: { token: json.token },
          connect: true,
        });

        prov.on("status", (e: { status: "connecting" | "connected" | "disconnected" }) => {
          if (cancelled) return;
          setStatus(e.status);
        });
        prov.on("connection-error", () => {
          if (cancelled) return;
          setStatus("error");
        });

        if (cancelled || requestedRoomRef.current !== room) {
          prov.destroy();
          return;
        }

        setYdoc(doc);
        setProvider(prov);
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (prov) {
        try {
          prov.destroy();
        } catch {
          /* ignore */
        }
      }
      try {
        doc.destroy();
      } catch {
        /* ignore */
      }
      setProvider(null);
      setYdoc(null);
    };
  }, [room]);

  return { ydoc, provider, status };
}
