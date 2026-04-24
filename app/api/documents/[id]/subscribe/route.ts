import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const VALID_EVENTS = new Set([
  "VERSION_UPLOADED", "APPROVED", "COMMENTED", "STATUS_CHANGED", "CHECKED_OUT",
]);

// GET /api/documents/[id]/subscribe — get current user's subscription
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sub = await db.documentSubscription.findUnique({
    where: { documentId_userId: { documentId: id, userId: session.user.id } },
  });
  return NextResponse.json(sub ?? null);
}

// PUT /api/documents/[id]/subscribe — create or replace subscription
// Body: { events: string[] }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const doc = await db.document.findUnique({ where: { id }, select: { id: true } });
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const body = await req.json() as { events?: string[] };
    const events = (body.events ?? [...VALID_EVENTS]).filter((e) => VALID_EVENTS.has(e));

    const sub = await db.documentSubscription.upsert({
      where: { documentId_userId: { documentId: id, userId: session.user.id } },
      create: { documentId: id, userId: session.user.id, events },
      update: { events },
    });

    return NextResponse.json(sub);
  } catch (error) {
    logger.error("Subscribe failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/documents/[id]/subscribe — unsubscribe
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.documentSubscription.deleteMany({
    where: { documentId: id, userId: session.user.id },
  });
  return NextResponse.json({ message: "Unsubscribed" });
}
