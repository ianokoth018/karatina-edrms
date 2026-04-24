import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resumeSignal } from "@/lib/workflow-engine";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import crypto from "crypto";

/**
 * POST /api/workflows/signals/[key]
 *
 * Fire a named signal to resume a paused wait_signal node.
 *
 * The [key] is the signalKey stored in WorkflowSignal — format: "{instanceId}:{nodeId}"
 * or a human-readable name if the designer set one.
 *
 * Authentication: session OR HMAC webhook token (X-Signal-Token header).
 * HMAC is verified with WORKFLOW_SIGNAL_SECRET env var using SHA-256.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;

    // ---- Auth: session user OR HMAC token ----
    let actorId = "SYSTEM";
    const hmacToken = req.headers.get("x-signal-token");
    const secret = process.env.WORKFLOW_SIGNAL_SECRET;

    if (hmacToken && secret) {
      // Verify HMAC-SHA256 of key
      const expected = crypto.createHmac("sha256", secret).update(key).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(hmacToken), Buffer.from(expected))) {
        return NextResponse.json({ error: "Invalid signal token" }, { status: 401 });
      }
    } else {
      // Fall back to session auth
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      actorId = session.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const payload = (body.payload ?? body) as Record<string, unknown>;

    const signal = await db.workflowSignal.findUnique({ where: { signalKey: key } });
    if (!signal) return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    if (signal.receivedAt) {
      return NextResponse.json({ message: "Signal already received", alreadyHandled: true });
    }

    const result = await resumeSignal({ signalKey: key, payload, actorId });

    logger.info("Signal received", { key, actorId, nextTasks: result.nextTasks });
    return NextResponse.json({
      ok: true,
      signalKey: key,
      resumed: result.resumed,
      nextTasks: result.nextTasks,
    });
  } catch (error) {
    logger.error("Failed to process workflow signal", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/workflows/signals/[key] — query signal status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { key } = await params;
    const signal = await db.workflowSignal.findUnique({ where: { signalKey: key } });
    if (!signal) return NextResponse.json({ error: "Signal not found" }, { status: 404 });

    return NextResponse.json({
      signalKey: signal.signalKey,
      instanceId: signal.instanceId,
      nodeId: signal.nodeId,
      received: !!signal.receivedAt,
      receivedAt: signal.receivedAt,
      payload: signal.payload,
    });
  } catch (error) {
    logger.error("Failed to get signal status", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
