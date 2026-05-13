import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  ComplianceFramework,
  resolveFramework,
  FRAMEWORK_LABELS,
} from "@/lib/compliance";

const FRAMEWORKS: ComplianceFramework[] = ["ISO15489", "ISO27001", "DPA-KE"];

function isFramework(v: string | null): v is ComplianceFramework {
  return v === "ISO15489" || v === "ISO27001" || v === "DPA-KE";
}

/**
 * GET /api/admin/compliance?framework=ISO15489|ISO27001|DPA-KE
 *
 * Returns a compliance evidence summary for one or all frameworks.
 * Admin-only. Each clause carries status / count / detail / optional link.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const param = new URL(req.url).searchParams.get("framework");

    let targets: ComplianceFramework[];
    if (param === null) {
      targets = FRAMEWORKS;
    } else if (isFramework(param)) {
      targets = [param];
    } else {
      return NextResponse.json(
        { error: "Invalid framework parameter" },
        { status: 400 },
      );
    }

    const results = await Promise.all(
      targets.map(async (framework) => ({
        framework,
        label: FRAMEWORK_LABELS[framework],
        clauses: await resolveFramework(framework),
      })),
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      frameworks: results,
    });
  } catch (error) {
    logger.error("Compliance dashboard failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
