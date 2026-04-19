import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await db.apiKey.findMany({
    where: { revokedAt: null },
    select: { id: true, name: true, scope: true, createdAt: true, lastUsedAt: true, createdById: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(keys);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, scope } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const existing = await db.apiKey.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "Name already taken" }, { status: 409 });

  const rawKey = `cap_${randomBytes(24).toString("hex")}`;
  const hashedKey = await bcrypt.hash(rawKey, 10);

  const apiKey = await db.apiKey.create({
    data: { name, hashedKey, scope: scope || "capture", createdById: session.user.id },
  });

  // Return raw key ONCE — never stored in plain text
  return NextResponse.json({ id: apiKey.id, name: apiKey.name, key: rawKey }, { status: 201 });
}
