import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

/** GET /api/admin/matters — list matters, optionally filter by status / search. */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const search = (searchParams.get("search") ?? "").trim();

    const matters = await db.legalMatter.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { matterNumber: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        name: true,
        matterNumber: true,
        description: true,
        status: true,
        openedAt: true,
        closedAt: true,
        _count: { select: { custodians: true, documents: true, notices: true } },
      },
    });

    return NextResponse.json({ matters });
  } catch (error) {
    logger.error("Failed to list matters", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** POST /api/admin/matters — create a matter. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as {
      name?: string;
      matterNumber?: string;
      description?: string;
    };
    const name = (body.name ?? "").trim();
    const matterNumber = (body.matterNumber ?? "").trim() || (await nextMatterNumber());
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const matter = await db.legalMatter.create({
      data: {
        name,
        matterNumber,
        description: body.description?.trim() || null,
        openedById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "legal_hold.matter_opened",
      resourceType: "LegalMatter",
      resourceId: matter.id,
      metadata: { name, matterNumber },
    });

    return NextResponse.json({ matter }, { status: 201 });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "Matter number already in use" }, { status: 409 });
    }
    logger.error("Failed to create matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Generate an unused matter number like "M-2026-001". */
async function nextMatterNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `M-${year}-`;
  const last = await db.legalMatter.findFirst({
    where: { matterNumber: { startsWith: prefix } },
    orderBy: { matterNumber: "desc" },
    select: { matterNumber: true },
  });
  let n = 1;
  if (last) {
    const tail = last.matterNumber.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }
  return `${prefix}${String(n).padStart(3, "0")}`;
}
