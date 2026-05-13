import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/disposition/certificates/[id]/approve
 *
 * Move a DRAFT cert to APPROVED. Requires `admin:manage` or
 * `records:dispose`. Audits the transition.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const perms = (session.user.permissions as string[] | undefined) ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("records:dispose")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const cert = await db.dispositionCertificate.findUnique({ where: { id } });
    if (!cert) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (cert.status !== "DRAFT") {
      return NextResponse.json(
        { error: `Can only approve a DRAFT certificate (current: ${cert.status})` },
        { status: 400 },
      );
    }

    const updated = await db.dispositionCertificate.update({
      where: { id },
      data: { status: "APPROVED", approvedById: session.user.id },
    });

    await writeAudit({
      userId: session.user.id,
      action: "disposition.certificate.approved",
      resourceType: "DispositionCertificate",
      resourceId: id,
      metadata: {
        certificateNo: cert.certificateNo,
        previousStatus: cert.status,
        newStatus: "APPROVED",
        documentCount: cert.documentCount,
      },
    });

    logger.info("Disposition certificate approved", {
      userId: session.user.id,
      certificateId: id,
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Approve disposition certificate failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
