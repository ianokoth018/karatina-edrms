/**
 * GET  /api/admin/storage/policy → current active policy (or defaults).
 * PUT  /api/admin/storage/policy → upsert active policy.
 *
 * Admin-only (admin:manage permission).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const POLICY_NAME = "default";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.user.permissions.includes("admin:manage")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const row = await db.storageTierPolicy.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    if (row) {
      return NextResponse.json({ policy: row });
    }
    // Surface defaults so the UI form always has something to edit.
    return NextResponse.json({
      policy: {
        id: null,
        name: POLICY_NAME,
        isActive: true,
        demoteToWarmDays: 90,
        demoteToArchiveDays: 365,
        restoreStrategy: "auto",
      },
    });
  } catch (err) {
    logger.error("storage policy GET failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  try {
    const body = await req.json();
    const warmDays = Number(body.demoteToWarmDays);
    const archiveDays = Number(body.demoteToArchiveDays);
    const restoreStrategy = String(body.restoreStrategy ?? "auto");

    if (!Number.isFinite(warmDays) || warmDays < 1) {
      return NextResponse.json({ error: "demoteToWarmDays must be a positive integer" }, { status: 400 });
    }
    if (!Number.isFinite(archiveDays) || archiveDays < 1) {
      return NextResponse.json({ error: "demoteToArchiveDays must be a positive integer" }, { status: 400 });
    }
    if (archiveDays <= warmDays) {
      return NextResponse.json(
        { error: "demoteToArchiveDays must be greater than demoteToWarmDays" },
        { status: 400 }
      );
    }
    if (restoreStrategy !== "auto" && restoreStrategy !== "manual") {
      return NextResponse.json({ error: "restoreStrategy must be 'auto' or 'manual'" }, { status: 400 });
    }

    const policy = await db.storageTierPolicy.upsert({
      where: { name: POLICY_NAME },
      create: {
        name: POLICY_NAME,
        demoteToWarmDays: Math.round(warmDays),
        demoteToArchiveDays: Math.round(archiveDays),
        restoreStrategy,
        isActive: true,
      },
      update: {
        demoteToWarmDays: Math.round(warmDays),
        demoteToArchiveDays: Math.round(archiveDays),
        restoreStrategy,
        isActive: true,
      },
    });
    return NextResponse.json({ policy });
  } catch (err) {
    logger.error("storage policy PUT failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
