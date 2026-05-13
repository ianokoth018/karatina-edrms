import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/matters/[id]/custodians — list custodians on a matter. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const custodians = await db.legalMatterCustodian.findMany({
      where: { matterId: id },
      orderBy: { addedAt: "asc" },
      include: { notice: true },
    });

    const userIds = custodians
      .map((c) => c.userId)
      .filter((u): u is string => !!u);
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, displayName: true, name: true, department: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      custodians: custodians.map((c) => ({
        ...c,
        user: c.userId ? userMap.get(c.userId) ?? null : null,
      })),
    });
  } catch (error) {
    logger.error("Failed to list custodians", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** POST /api/admin/matters/[id]/custodians — add a custodian (internal or external). */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const matter = await db.legalMatter.findUnique({
      where: { id },
      select: { id: true, status: true, matterNumber: true },
    });
    if (!matter) return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    if (matter.status !== "OPEN") {
      return NextResponse.json({ error: "Matter is closed" }, { status: 400 });
    }

    const body = (await req.json()) as {
      userId?: string | null;
      externalName?: string;
      externalEmail?: string;
    };

    if (!body.userId && !body.externalEmail) {
      return NextResponse.json(
        { error: "Provide either userId or externalEmail" },
        { status: 400 }
      );
    }

    if (body.userId) {
      const exists = await db.legalMatterCustodian.findUnique({
        where: { matterId_userId: { matterId: id, userId: body.userId } },
        select: { id: true },
      });
      if (exists) {
        return NextResponse.json({ error: "Custodian already on this matter" }, { status: 409 });
      }
    }

    const custodian = await db.legalMatterCustodian.create({
      data: {
        matterId: id,
        userId: body.userId ?? null,
        externalName: body.userId ? null : (body.externalName?.trim() || null),
        externalEmail: body.userId ? null : (body.externalEmail?.trim().toLowerCase() || null),
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "legal_hold.custodian_added",
      resourceType: "LegalMatterCustodian",
      resourceId: custodian.id,
      metadata: {
        matterId: id,
        matterNumber: matter.matterNumber,
        userId: custodian.userId,
        externalEmail: custodian.externalEmail,
      },
    });

    return NextResponse.json({ custodian }, { status: 201 });
  } catch (error) {
    logger.error("Failed to add custodian", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
