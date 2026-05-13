/**
 * POST /api/admin/storage/restore { fileId }
 *
 * Manually restore a single archived file back to hot. Used when
 * restoreStrategy is "manual" — a user requested access to an archived
 * file and an admin is fulfilling the request.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { moveFileToTier } from "@/lib/storage-tier";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.permissions.includes("admin:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const fileId = typeof body.fileId === "string" ? body.fileId : null;
    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }
    const file = await db.documentFile.findUnique({ where: { id: fileId } });
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (file.storageTier === "hot") {
      return NextResponse.json({ ok: true, alreadyHot: true });
    }
    await moveFileToTier(file, "hot");
    logger.info("storage tiering: manual restore", { userId: session.user.id, fileId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("storage tiering: manual restore failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
