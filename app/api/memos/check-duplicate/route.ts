import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/memos/check-duplicate?subject=...&referenceNumber=...
 *
 * Lightweight pre-submit check called from the composer (debounced
 * onChange of subject / reference). Returns matches so the composer
 * can warn early — before the user wastes time at preview / submit.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ matches: [] });
    }
    const { searchParams } = req.nextUrl;
    const subject = searchParams.get("subject")?.trim();
    const referenceNumber = searchParams.get("referenceNumber")?.trim();
    if (!subject && !referenceNumber) {
      return NextResponse.json({ matches: [] });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      initiatedById: session.user.id,
      OR: [],
    };
    if (referenceNumber) {
      where.OR.push({
        document: { referenceNumber: { equals: referenceNumber, mode: "insensitive" } },
      });
    }
    if (subject && subject.length >= 3) {
      where.OR.push({ subject: { equals: subject, mode: "insensitive" } });
    }
    if (where.OR.length === 0) return NextResponse.json({ matches: [] });

    const matches = await db.workflowInstance.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        subject: true,
        startedAt: true,
        status: true,
        referenceNumber: true,
        document: { select: { referenceNumber: true } },
      },
    });

    return NextResponse.json({
      matches: matches.map((m) => ({
        id: m.id,
        subject: m.subject,
        status: m.status,
        startedAt: m.startedAt,
        referenceNumber: m.document?.referenceNumber ?? m.referenceNumber,
      })),
    });
  } catch (error) {
    logger.error("Failed to check duplicate memo", error);
    return NextResponse.json({ matches: [] });
  }
}
