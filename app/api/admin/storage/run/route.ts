/**
 * POST /api/admin/storage/run — trigger an immediate tiering pass.
 *
 * Admin-only. Runs synchronously; for large datasets the worker should
 * handle it overnight instead.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyTieringPolicy } from "@/lib/storage-tier";
import { logger } from "@/lib/logger";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.permissions.includes("admin:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await applyTieringPolicy();
    logger.info("storage tiering: manual run", { userId: session.user.id, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("storage tiering: manual run failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
