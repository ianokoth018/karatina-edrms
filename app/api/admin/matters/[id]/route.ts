import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { closeMatter, reopenMatter } from "@/lib/legal-hold";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/matters/[id] — full matter detail with custodians + documents + notices. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const matter = await db.legalMatter.findUnique({
      where: { id },
      include: {
        custodians: {
          orderBy: { addedAt: "asc" },
          include: { notice: true },
        },
        documents: {
          orderBy: { addedAt: "desc" },
          include: {
            document: {
              select: { id: true, referenceNumber: true, title: true, documentType: true },
            },
          },
        },
        notices: {
          orderBy: { sentAt: "desc" },
        },
      },
    });
    if (!matter) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Hydrate user info for internal-user custodians.
    const userIds = matter.custodians
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
      matter: {
        ...matter,
        custodians: matter.custodians.map((c) => ({
          ...c,
          user: c.userId ? userMap.get(c.userId) ?? null : null,
        })),
      },
    });
  } catch (error) {
    logger.error("Failed to load matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** PATCH /api/admin/matters/[id] — update fields and/or status (OPEN ↔ CLOSED). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      status?: "OPEN" | "CLOSED";
    };

    const existing = await db.legalMatter.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Status transitions go through the sync layer so isOnLegalHold stays correct.
    if (body.status && body.status !== existing.status) {
      if (body.status === "CLOSED") {
        await closeMatter(id, session.user.id);
      } else if (body.status === "OPEN") {
        await reopenMatter(id, session.user.id);
      }
    }

    const matter = await db.legalMatter.update({
      where: { id },
      data: {
        name: body.name?.trim() || undefined,
        description: body.description === undefined ? undefined : (body.description?.trim() || null),
      },
    });

    return NextResponse.json({ matter });
  } catch (error) {
    logger.error("Failed to update matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/matters/[id] — only when closed. Recomputes holds first. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const matter = await db.legalMatter.findUnique({
      where: { id },
      select: { id: true, status: true, matterNumber: true, name: true },
    });
    if (!matter) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Force a close first so isOnLegalHold gets recomputed for every doc on
    // the matter. Cascading deletes wipe the join rows, but they bypass our
    // sync logic — closing first keeps the canonical flag honest.
    if (matter.status === "OPEN") {
      await closeMatter(id, session.user.id);
    }

    await db.legalMatter.delete({ where: { id } });
    await writeAudit({
      userId: session.user.id,
      action: "legal_hold.matter_deleted",
      resourceType: "LegalMatter",
      resourceId: id,
      metadata: { matterNumber: matter.matterNumber, name: matter.name },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
