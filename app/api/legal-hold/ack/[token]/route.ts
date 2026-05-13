import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { acknowledgeNotice, verifyAckToken } from "@/lib/legal-hold";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/legal-hold/ack/[token] — public, no auth.
 * Validates the signed token, returns the matter + custodian context for the
 * ack page (or an "expired" / "invalid" / "already_acknowledged" indicator).
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    const parsed = verifyAckToken(token);
    if (!parsed) {
      return NextResponse.json({ valid: false, reason: "invalid" }, { status: 200 });
    }

    const notice = await db.legalHoldNotice.findUnique({
      where: { ackToken: token },
      include: {
        matter: { select: { name: true, matterNumber: true, status: true, description: true } },
        custodian: {
          select: {
            id: true,
            userId: true,
            externalName: true,
            externalEmail: true,
          },
        },
      },
    });
    if (!notice) {
      return NextResponse.json({ valid: false, reason: "invalid" }, { status: 200 });
    }

    let custodianName = notice.custodian.externalName ?? "Custodian";
    let custodianEmail = notice.custodian.externalEmail ?? null;
    if (notice.custodian.userId) {
      const u = await db.user.findUnique({
        where: { id: notice.custodian.userId },
        select: { email: true, displayName: true, name: true },
      });
      if (u) {
        custodianName = u.displayName ?? u.name ?? custodianName;
        custodianEmail = u.email;
      }
    }

    return NextResponse.json({
      valid: true,
      acknowledged: !!notice.acknowledgedAt,
      acknowledgedAt: notice.acknowledgedAt,
      sentAt: notice.sentAt,
      matter: notice.matter,
      custodian: { name: custodianName, email: custodianEmail },
    });
  } catch (error) {
    logger.error("Failed to load ack token info", error);
    return NextResponse.json({ valid: false, reason: "error" }, { status: 500 });
  }
}

/** POST /api/legal-hold/ack/[token] — public, records the acknowledgement. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    const parsed = verifyAckToken(token);
    if (!parsed) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
    }

    const notice = await db.legalHoldNotice.findUnique({
      where: { ackToken: token },
      select: { id: true, acknowledgedAt: true },
    });
    if (!notice) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
    }
    if (notice.acknowledgedAt) {
      return NextResponse.json({ ok: true, already: true, acknowledgedAt: notice.acknowledgedAt });
    }

    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    await acknowledgeNotice(notice.id, { ipAddress, userAgent });

    const updated = await db.legalHoldNotice.findUnique({
      where: { id: notice.id },
      select: { acknowledgedAt: true },
    });
    return NextResponse.json({ ok: true, acknowledgedAt: updated?.acknowledgedAt ?? null });
  } catch (error) {
    logger.error("Failed to record ack", error);
    return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });
  }
}
