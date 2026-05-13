import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string; custodianId: string }> };

/** DELETE /api/admin/matters/[id]/custodians/[custodianId] — remove a custodian. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, custodianId } = await params;
    const custodian = await db.legalMatterCustodian.findUnique({
      where: { id: custodianId },
      select: { id: true, matterId: true, userId: true, externalEmail: true },
    });
    if (!custodian || custodian.matterId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.legalMatterCustodian.delete({ where: { id: custodianId } });

    await writeAudit({
      userId: session.user.id,
      action: "legal_hold.custodian_removed",
      resourceType: "LegalMatterCustodian",
      resourceId: custodianId,
      metadata: {
        matterId: id,
        userId: custodian.userId,
        externalEmail: custodian.externalEmail,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to remove custodian", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
