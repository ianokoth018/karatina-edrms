import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "PENDING";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = 20;

  const [items, total] = await Promise.all([
    db.captureException.findMany({
      where: { status: status as "PENDING" | "RESOLVED" | "REJECTED" },
      include: { profile: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.captureException.count({ where: { status: status as "PENDING" | "RESOLVED" | "REJECTED" } }),
  ]);

  return NextResponse.json({ items, total, page, pages: Math.ceil(total / limit) });
}
