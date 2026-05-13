/**
 * Yjs realtime co-editing server.
 *
 * Standalone Node process (run via `npm run dev:realtime`) that hosts the
 * y-websocket transport for CRDT documents. One process serves every room
 * — Yjs keeps each room's state in-memory in a Map<roomId, Y.Doc>.
 *
 * Auth: every connection MUST present a `?token=...` query param. The
 * token is verified via HMAC-SHA256 over `{room,userId,exp}` using
 * `REALTIME_SECRET` (falls back to AUTH_SECRET) — see
 * `lib/realtime-token.ts`. Anonymous / unverifiable connections are
 * rejected with WS close code 4001.
 *
 * Tokens are issued by `POST /api/realtime/token` from a session-
 * authenticated browser, so anonymous network peers can't open rooms.
 *
 * Env:
 *   WS_PORT          listen port (default 1234)
 *   WS_HOST          listen host (default 0.0.0.0)
 *   REALTIME_SECRET  HMAC key — fall back to AUTH_SECRET / NEXTAUTH_SECRET
 *
 * The server uses `@y/websocket-server`'s setupWSConnection — that's the
 * supported entry point now that `y-websocket@3` no longer ships a bin/
 * utility.
 */

import http from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { setupWSConnection } from "@y/websocket-server/utils";
import { logger } from "@/lib/logger";
import { verifyRoomToken } from "@/lib/realtime-token";

const PORT = parseInt(process.env.WS_PORT ?? "1234", 10);
const HOST = process.env.WS_HOST ?? "0.0.0.0";

// We use `noServer: true` so we can run our own auth check during the HTTP
// upgrade handshake before handing the socket to ws.
const wss = new WebSocketServer({ noServer: true });

let connectionCount = 0;

wss.on("connection", (conn: WebSocket, req: http.IncomingMessage) => {
  connectionCount += 1;
  const room = (req.url || "").slice(1).split("?")[0] || "(unknown)";
  logger.info("realtime-server: client connected", {
    room: decodeURIComponent(room),
    connections: connectionCount,
  });

  conn.on("close", () => {
    connectionCount = Math.max(0, connectionCount - 1);
    logger.info("realtime-server: client disconnected", {
      room: decodeURIComponent(room),
      connections: connectionCount,
    });
  });

  // Hand off to y-websocket-server's shared-doc machinery.
  setupWSConnection(conn, req);
});

const httpServer = http.createServer((_req, res) => {
  // Health check — also makes it easy to confirm the process is reachable
  // before debugging an upgrade failure.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "edrms-realtime",
      connections: connectionCount,
    })
  );
});

httpServer.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host ?? "localhost"}`);
    const room = decodeURIComponent(url.pathname.slice(1));
    const token = url.searchParams.get("token");

    if (!room) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const result = verifyRoomToken(token, room);
    if (!result.ok) {
      logger.warn("realtime-server: rejected connection", {
        room,
        reason: result.reason,
      });
      // close code 4001 is reserved for application "auth" failure
      // per y-websocket convention; we use it after the upgrade to give
      // the client a clean error to surface.
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4001, "auth");
      });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    logger.error("realtime-server: upgrade error", err);
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  logger.info("realtime-server started", { host: HOST, port: PORT });
});

async function shutdown(signal: string) {
  logger.info(`realtime-server: received ${signal}, shutting down`);
  // Close all active WS connections then the HTTP server.
  for (const client of wss.clients) {
    try {
      client.close(1001, "server-shutdown");
    } catch {
      /* ignore */
    }
  }
  wss.close();
  httpServer.close(() => {
    process.exit(0);
  });
  // Hard cutoff if close() hangs.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
