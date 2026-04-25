import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/drafts
 *
 * List the current user's in-progress memo drafts (most recently edited
 * first). Used by the Drafts tab on the memos list and by the composer
 * to surface "resume your last draft" prompts.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const drafts = await db.memoDraft.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ drafts });
  } catch (error) {
    logger.error("Failed to list memo drafts", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/memos/drafts
 *
 * Create a new draft. Body: { subject?: string; payload: Record<string, unknown> }.
 * Returns { id } so the composer can switch into "resume mode" and start
 * autosaving via PUT.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      payload?: Record<string, unknown>;
    };
    const subject =
      typeof body.subject === "string" && body.subject.trim().length > 0
        ? body.subject.trim().slice(0, 200)
        : "Untitled draft";

    const draft = await db.memoDraft.create({
      data: {
        userId: session.user.id,
        subject,
        payload: (body.payload ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true, subject: true, updatedAt: true },
    });

    return NextResponse.json(draft);
  } catch (error) {
    logger.error("Failed to create memo draft", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
