import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const VALID_RESOURCE_TYPES = new Set([
  "document",
  "memo",
  "workflow",
  "form",
]);

/**
 * POST /api/presence/heartbeat
 *
 * Body: { resourceType: string, resourceId: string }
 *
 * Upserts a single row keyed by (userId, resourceType, resourceId) and
 * refreshes lastSeenAt. Called every ~10s by `usePresence` while a viewer
 * has the resource page open.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { resourceType, resourceId } = (body ?? {}) as {
    resourceType?: unknown;
    resourceId?: unknown;
  };

  if (
    typeof resourceType !== "string" ||
    typeof resourceId !== "string" ||
    !resourceType ||
    !resourceId
  ) {
    return NextResponse.json(
      { error: "resourceType and resourceId are required" },
      { status: 400 },
    );
  }

  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    return NextResponse.json(
      { error: "Unsupported resourceType" },
      { status: 400 },
    );
  }

  const now = new Date();

  await db.presenceHeartbeat.upsert({
    where: {
      userId_resourceType_resourceId: {
        userId: session.user.id,
        resourceType,
        resourceId,
      },
    },
    update: { lastSeenAt: now },
    create: {
      userId: session.user.id,
      resourceType,
      resourceId,
      lastSeenAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}
