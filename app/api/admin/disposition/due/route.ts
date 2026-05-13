import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { findDueForDisposition } from "@/lib/retention-disposition";

/**
 * GET /api/admin/disposition/due
 *
 * Lists every document currently overdue for disposition, joined with the
 * action declared by its retention schedule. Admin-only.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const perms = (session.user.permissions as string[] | undefined) ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("records:dispose")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const due = await findDueForDisposition();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      count: due.length,
      documents: due,
    });
  } catch (error) {
    logger.error("Disposition due-list failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
