import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { executeDisposition } from "@/lib/retention-disposition";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/disposition/certificates/[id]/execute
 *
 * Carry out the disposition described by an APPROVED certificate. Admin
 * only. Returns { disposed, archived, skipped[], needsReview }.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const perms = (session.user.permissions as string[] | undefined) ?? [];
    if (!perms.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    try {
      const result = await executeDisposition(id, session.user.id);
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    logger.error("Execute disposition certificate failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
