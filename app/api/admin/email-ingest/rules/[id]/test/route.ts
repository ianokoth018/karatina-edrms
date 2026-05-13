import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { testEmailIngestRule } from "@/lib/email-ingest";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/email-ingest/rules/[id]/test
 * Connect to IMAP and report success/error WITHOUT ingesting any messages.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const rule = await db.emailIngestRule.findUnique({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await testEmailIngestRule(rule);

    await writeAudit({
      userId: session.user.id,
      action: "admin.email_ingest_rule_tested",
      resourceType: "EmailIngestRule",
      resourceId: id,
      metadata: { ok: result.ok, error: result.ok ? null : result.error },
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    logger.error("Failed to test email ingest rule", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
