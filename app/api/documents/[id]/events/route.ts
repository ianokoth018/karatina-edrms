import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * POST /api/documents/[id]/events
 *
 * Lightweight endpoint for recording client-side events that can't be observed
 * server-side — currently just `printed`, since `window.print()` has no
 * server hook. The client is expected to call this immediately before
 * invoking `window.print()`.
 *
 * Body: { type: "printed" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    let body: { type?: string } = {};
    try {
      body = (await req.json()) as { type?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const type = body?.type;
    if (!type || typeof type !== "string") {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }

    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true, title: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    let action: string | null = null;
    switch (type) {
      case "printed":
        action = "document.printed";
        break;
      default:
        return NextResponse.json(
          { error: `Unknown event type: ${type}` },
          { status: 400 }
        );
    }

    await writeAudit({
      userId: session.user.id,
      action,
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: {
        referenceNumber: doc.referenceNumber,
        title: doc.title,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to record document event", error, {
      route: "/api/documents/[id]/events",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
