import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const trigger = await db.captureTrigger.update({
    where: { id },
    data: {
      profileId: body.profileId ?? undefined,
      documentTypeFilter: body.documentTypeFilter ?? undefined,
      studentFilter: body.studentFilter ?? undefined,
      channelType: body.channelType ?? undefined,
      channelConfig: body.channelConfig ?? undefined,
      enabled: body.enabled ?? undefined,
    },
  });
  return NextResponse.json(trigger);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.captureTrigger.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
