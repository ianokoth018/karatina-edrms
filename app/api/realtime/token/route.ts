import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { createRoomToken } from "@/lib/realtime-token";

/**
 * POST /api/realtime/token
 *
 * Body: { room: string }
 * Returns: { token, wsUrl, expiresAt }
 *
 * The session-authenticated user gets a 1h HMAC token bound to the requested
 * room. The browser opens `wsUrl?token=<token>` directly against the
 * standalone Yjs WebSocket server (scripts/realtime-server.ts), which
 * verifies the same token with no DB lookup.
 *
 * `wsUrl` is the base URL only — `${WS_URL}/${room}?token=...` is assembled
 * here so the client doesn't need to know the env var, and so we can
 * percent-encode the room consistently.
 */

interface TokenBody {
  room?: string;
}

// Loose validation — room names should be safe for URL paths.
const ROOM_RE = /^[A-Za-z0-9_\-:.]{1,200}$/;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as TokenBody | null;
    const room = body?.room?.trim();
    if (!room || !ROOM_RE.test(room)) {
      return NextResponse.json(
        { error: "Invalid or missing room" },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const { token, expiresAt } = createRoomToken(room, userId);

    const base =
      process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
    const wsUrl = `${base.replace(/\/$/, "")}/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}`;

    return NextResponse.json({ token, wsUrl, expiresAt });
  } catch (error) {
    logger.error("realtime token issue failed", error, {
      route: "/api/realtime/token",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
