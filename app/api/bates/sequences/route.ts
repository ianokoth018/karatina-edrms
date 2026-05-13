import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function adminGate(session: { user?: { permissions?: string[] } } | null) {
  if (!session?.user) return { ok: false, status: 401 as const };
  if (!session.user.permissions?.includes("admin:manage"))
    return { ok: false, status: 403 as const };
  return { ok: true as const };
}

export async function GET() {
  const session = await auth();
  const gate = adminGate(session);
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  const sequences = await db.batesSequence.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { productions: true } } },
  });
  return NextResponse.json({ sequences });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const gate = adminGate(session);
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const body = await req.json();
    const { name, prefix, pad, description } = body as {
      name: string;
      prefix: string;
      pad?: number;
      description?: string;
    };
    if (!name?.trim() || !prefix?.trim()) {
      return NextResponse.json(
        { error: "name and prefix are required" },
        { status: 400 }
      );
    }
    const seq = await db.batesSequence.create({
      data: {
        name: name.trim(),
        prefix: prefix.trim().toUpperCase(),
        pad: Math.max(3, Math.min(10, pad ?? 6)),
        description: description?.trim() ?? null,
        createdById: session!.user!.id!,
      },
    });
    await writeAudit({
      userId: session!.user!.id!,
      action: "bates.sequence_created",
      resourceType: "BatesSequence",
      resourceId: seq.id,
      metadata: { name, prefix, pad: seq.pad },
    });
    return NextResponse.json({ sequence: seq }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create Bates sequence", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
