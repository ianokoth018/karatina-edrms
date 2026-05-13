import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendHoldNotice } from "@/lib/legal-hold";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/matters/[id]/notices
 * Send a hold notice to every custodian on the matter who hasn't yet
 * acknowledged. Pass `{ custodianId }` in the body to send to one specific
 * custodian (re-send). Pass `{ force: true }` to re-send to all custodians,
 * including those who already acknowledged.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      custodianId?: string;
      force?: boolean;
    };

    const matter = await db.legalMatter.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!matter) return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    if (matter.status !== "OPEN") {
      return NextResponse.json({ error: "Matter is closed" }, { status: 400 });
    }

    const targets = body.custodianId
      ? await db.legalMatterCustodian.findMany({
          where: { id: body.custodianId, matterId: id },
          include: { notice: true },
        })
      : await db.legalMatterCustodian.findMany({
          where: { matterId: id },
          include: { notice: true },
        });

    if (targets.length === 0) {
      return NextResponse.json({ error: "No custodians on this matter" }, { status: 400 });
    }

    // Build the origin once so all emails point at the right host.
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const origin = host ? `${proto}://${host}` : new URL(req.url).origin;

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const noticeIds: string[] = [];
    for (const c of targets) {
      // Skip already-acknowledged custodians unless force or specific custodian requested.
      if (!body.force && !body.custodianId && c.notice?.acknowledgedAt) {
        skipped++;
        continue;
      }
      try {
        const result = await sendHoldNotice(c.id, session.user.id, origin);
        noticeIds.push(result.noticeId);
        if (result.sent) sent++;
        else failed++;
      } catch (e) {
        failed++;
        logger.error("Failed sending one hold notice", e, { custodianId: c.id });
      }
    }

    return NextResponse.json({ sent, skipped, failed, total: targets.length, noticeIds });
  } catch (error) {
    logger.error("Failed to send hold notices", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
