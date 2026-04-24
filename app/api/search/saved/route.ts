import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// GET /api/search/saved — list user's saved searches + public ones
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searches = await db.savedSearch.findMany({
      where: {
        OR: [{ userId: session.user.id }, { isPublic: true }],
      },
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { displayName: true } } },
    });

    return NextResponse.json(searches);
  } catch (error) {
    logger.error("Failed to list saved searches", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/search/saved — create a saved search
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      name?: string;
      query?: Record<string, unknown>;
      isPublic?: boolean;
      icon?: string;
    };

    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.query || typeof body.query !== "object") {
      return NextResponse.json({ error: "query must be an object" }, { status: 400 });
    }

    const saved = await db.savedSearch.create({
      data: {
        userId: session.user.id,
        name: body.name.trim(),
        query: body.query as import("@prisma/client").Prisma.InputJsonValue,
        isPublic: body.isPublic ?? false,
        icon: body.icon ?? null,
      },
    });

    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    logger.error("Failed to create saved search", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
