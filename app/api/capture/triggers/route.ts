import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const triggers = await db.captureTrigger.findMany({
    include: { profile: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(triggers);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { profileId, documentTypeFilter, studentFilter, channelType, channelConfig, enabled } = body;

  if (!channelType) return NextResponse.json({ error: "channelType required" }, { status: 400 });

  const trigger = await db.captureTrigger.create({
    data: {
      profileId: profileId || null,
      documentTypeFilter: documentTypeFilter || null,
      studentFilter: studentFilter || null,
      channelType,
      channelConfig: channelConfig || {},
      enabled: enabled !== false,
      createdById: session.user.id,
    },
  });
  return NextResponse.json(trigger, { status: 201 });
}
