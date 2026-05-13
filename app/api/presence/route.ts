import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const PRESENCE_WINDOW_MS = 30_000;

/**
 * GET /api/presence?resourceType=document&resourceId=xxx
 *
 * Returns the set of users active on the resource within the last 30s.
 * The caller is included in the list — `<PresenceStrip />` filters self
 * out client-side.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const resourceType = searchParams.get("resourceType");
  const resourceId = searchParams.get("resourceId");

  if (!resourceType || !resourceId) {
    return NextResponse.json(
      { error: "resourceType and resourceId are required" },
      { status: 400 },
    );
  }

  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);

  const rows = await db.presenceHeartbeat.findMany({
    where: {
      resourceType,
      resourceId,
      lastSeenAt: { gte: cutoff },
    },
    select: {
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
          name: true,
        },
      },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  // De-dupe by userId (the unique constraint guarantees one row per user
  // per resource, but the select shape is the same regardless).
  const seen = new Set<string>();
  const viewers = rows
    .filter((r) => {
      if (seen.has(r.user.id)) return false;
      seen.add(r.user.id);
      return true;
    })
    .map((r) => {
      const display = r.user.displayName || r.user.name || "User";
      const initials = display
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p.charAt(0).toUpperCase())
        .join("");
      return {
        id: r.user.id,
        displayName: display,
        initials: initials || display.charAt(0).toUpperCase() || "?",
        lastSeenAt: r.lastSeenAt.toISOString(),
      };
    });

  return NextResponse.json({ viewers });
}
