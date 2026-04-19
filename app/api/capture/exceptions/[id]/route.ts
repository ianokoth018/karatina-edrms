import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action } = body; // "resolve" | "reject"

  if (!["resolve", "reject"].includes(action)) {
    return NextResponse.json({ error: "action must be resolve or reject" }, { status: 400 });
  }

  const updated = await db.captureException.update({
    where: { id },
    data: {
      status: action === "resolve" ? "RESOLVED" : "REJECTED",
      resolvedById: session.user.id,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
