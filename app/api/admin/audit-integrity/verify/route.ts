import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { verifyAuditChain } from "@/lib/audit-verify";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = await verifyAuditChain();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Audit integrity verification failed", error, {
      route: "/api/admin/audit-integrity/verify",
    });
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
