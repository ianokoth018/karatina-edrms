import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const VALID_TYPES = new Set([
  "SUPERSEDES", "SUPPORTS", "RELATED_TO", "TRANSLATES", "REPLACES",
]);

// GET /api/documents/[id]/relations
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const [from, to] = await Promise.all([
      db.documentRelation.findMany({
        where: { sourceId: id },
        include: {
          target: { select: { id: true, referenceNumber: true, title: true, documentType: true, status: true } },
          createdBy: { select: { displayName: true } },
        },
      }),
      db.documentRelation.findMany({
        where: { targetId: id },
        include: {
          source: { select: { id: true, referenceNumber: true, title: true, documentType: true, status: true } },
          createdBy: { select: { displayName: true } },
        },
      }),
    ]);

    return NextResponse.json({ outgoing: from, incoming: to });
  } catch (error) {
    logger.error("Failed to list relations", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/documents/[id]/relations
// Body: { targetId, relationType, note? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { targetId?: string; relationType?: string; note?: string };

    if (!body.targetId) return NextResponse.json({ error: "targetId is required" }, { status: 400 });
    if (!body.relationType || !VALID_TYPES.has(body.relationType)) {
      return NextResponse.json(
        { error: `relationType must be one of: ${[...VALID_TYPES].join(", ")}` },
        { status: 400 }
      );
    }
    if (body.targetId === id) {
      return NextResponse.json({ error: "A document cannot be related to itself" }, { status: 400 });
    }

    const [source, target] = await Promise.all([
      db.document.findUnique({ where: { id }, select: { id: true } }),
      db.document.findUnique({ where: { id: body.targetId }, select: { id: true } }),
    ]);
    if (!source) return NextResponse.json({ error: "Source document not found" }, { status: 404 });
    if (!target) return NextResponse.json({ error: "Target document not found" }, { status: 404 });

    const relation = await db.documentRelation.create({
      data: {
        sourceId: id,
        targetId: body.targetId,
        relationType: body.relationType,
        note: body.note ?? null,
        createdById: session.user.id,
      },
      include: {
        target: { select: { id: true, referenceNumber: true, title: true } },
      },
    });

    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;
    await writeAudit({
      userId: session.user.id,
      action: "document.relation_added",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { targetId: body.targetId, relationType: body.relationType },
    });

    return NextResponse.json(relation, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "This relationship already exists" }, { status: 409 });
    }
    logger.error("Failed to create relation", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
