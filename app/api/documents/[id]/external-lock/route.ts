import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import {
  acquireExternalLock,
  releaseExternalLock,
} from "@/lib/document-locks";

/**
 * Authenticate the request via either:
 *   - an active session (admin or integration user), OR
 *   - an `x-api-key` header matching an active ApiKey row (bcrypt hashed).
 *
 * Returns the userId attributable for audit purposes, or null if neither
 * mechanism authenticates the request.
 */
async function authenticate(req: NextRequest): Promise<{
  userId: string | null;
  via: "session" | "apiKey";
} | null> {
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, via: "session" };
  }
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;
  const keys = await db.apiKey.findMany({
    where: { revokedAt: null },
    select: { id: true, hashedKey: true, createdById: true },
  });
  for (const k of keys) {
    if (await bcrypt.compare(apiKey, k.hashedKey)) {
      return { userId: k.createdById ?? null, via: "apiKey" };
    }
  }
  return null;
}

/** POST /api/documents/[id]/external-lock — acquire an external lock. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authed = await authenticate(req);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = (await req.json()) as {
      sourceSystem?: string;
      sourceType?: string;
      sourceRef?: string;
      reason?: string;
    };
    if (!body.sourceSystem || !body.sourceType || !body.sourceRef) {
      return NextResponse.json(
        { error: "sourceSystem, sourceType, sourceRef are required" },
        { status: 400 }
      );
    }
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const lock = await acquireExternalLock({
      documentId: id,
      sourceSystem: body.sourceSystem,
      sourceType: body.sourceType,
      sourceRef: body.sourceRef,
      lockedById: authed.userId ?? undefined,
      reason: body.reason ?? null,
    });

    await writeAudit({
      userId: authed.userId ?? undefined,
      action: "document.external_lock_acquired",
      resourceType: "Document",
      resourceId: id,
      metadata: {
        sourceSystem: body.sourceSystem,
        sourceType: body.sourceType,
        sourceRef: body.sourceRef,
        via: authed.via,
      },
    });

    return NextResponse.json({
      id: lock.id,
      documentId: lock.documentId,
      sourceSystem: lock.sourceSystem,
      sourceType: lock.sourceType,
      sourceRef: lock.sourceRef,
      lockedAt: lock.lockedAt,
    });
  } catch (error) {
    logger.error("Failed to acquire external lock", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/documents/[id]/external-lock?lockId=... — release a lock. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authed = await authenticate(req);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const lockId = new URL(req.url).searchParams.get("lockId");
    if (!lockId) {
      return NextResponse.json(
        { error: "lockId query param required" },
        { status: 400 }
      );
    }
    const lock = await db.documentExternalLock.findUnique({
      where: { id: lockId },
      select: { id: true, documentId: true, releasedAt: true },
    });
    if (!lock || lock.documentId !== id) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }
    if (lock.releasedAt) {
      return NextResponse.json({ ok: true, alreadyReleased: true });
    }

    await releaseExternalLock({
      lockId,
      releasedById: authed.userId ?? "system",
    });

    await writeAudit({
      userId: authed.userId ?? undefined,
      action: "document.external_lock_released",
      resourceType: "Document",
      resourceId: id,
      metadata: { lockId, via: authed.via },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to release external lock", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
