import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// PATCH /api/search/saved/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const saved = await db.savedSearch.findUnique({ where: { id } });
    if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (saved.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json() as { name?: string; query?: Record<string, unknown>; isPublic?: boolean; icon?: string };

    const updated = await db.savedSearch.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.query ? { query: body.query as import("@prisma/client").Prisma.InputJsonValue } : {}),
        ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update saved search", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/search/saved/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const saved = await db.savedSearch.findUnique({ where: { id } });
    if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAdmin = (session.user as { roles?: string[] }).roles?.some(
      (r) => ["admin", "super_admin"].includes(r.toLowerCase())
    );
    if (saved.userId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.savedSearch.delete({ where: { id } });
    return NextResponse.json({ message: "Deleted" });
  } catch (error) {
    logger.error("Failed to delete saved search", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
