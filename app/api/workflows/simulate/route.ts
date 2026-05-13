import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { simulateWorkflow } from "@/lib/workflow-simulator";

/**
 * POST /api/workflows/simulate
 * Body: { definition: { nodes, edges }, formData?: Record<string, unknown> }
 *
 * Pure dry-run — no database writes, no emails, no HTTP calls. Returns a
 * traversal trace the designer can render so non-devs can verify their
 * flow routes correctly before publishing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const definition = body.definition;
    const formData = (body.formData ?? {}) as Record<string, unknown>;

    if (!definition || !Array.isArray(definition.nodes)) {
      return NextResponse.json(
        { error: "definition with nodes/edges is required" },
        { status: 400 }
      );
    }

    const result = simulateWorkflow(definition, formData);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Workflow simulation failed", error);
    return NextResponse.json(
      { error: "Simulation failed" },
      { status: 500 }
    );
  }
}
