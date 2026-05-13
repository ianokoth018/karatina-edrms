import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * PATCH /api/admin/translations/cache/[id]
 * Body: { targetText: string }
 *
 * Admin override — replaces the cached translation with a human-edited
 * version and records `createdById` so the bulk re-translate job can skip
 * curated rows.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = (await req.json()) as { targetText?: unknown };
    const targetText =
      typeof body.targetText === "string" ? body.targetText.trim() : "";

    if (!targetText) {
      return NextResponse.json(
        { error: "targetText is required" },
        { status: 400 }
      );
    }

    const existing = await db.translationCache.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await db.translationCache.update({
      where: { id },
      data: {
        targetText,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "TRANSLATION_CACHE_UPDATED",
      resourceType: "translation_cache",
      resourceId: id,
      metadata: {
        sourceLocale: existing.sourceLocale,
        targetLocale: existing.targetLocale,
      },
    });

    return NextResponse.json({ entry: updated });
  } catch (error) {
    logger.error("Failed to patch translation cache entry", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
