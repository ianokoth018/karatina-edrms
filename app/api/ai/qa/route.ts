import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai/config";
import { askCorpus } from "@/lib/ai-qa";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * POST /api/ai/qa — "Chat with your documents".
 *
 * Body: { question: string, k?: number }
 * Auth: session required.
 * Returns: QaAnswer (see lib/ai-qa.ts) or 503 when no provider is
 * configured.
 *
 * Every Q&A request is audited as `ai.qa` with `{ question, citationCount }`.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!aiEnabled()) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 503 }
      );
    }

    let body: { question?: unknown; k?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }
    const k =
      typeof body.k === "number" && Number.isFinite(body.k)
        ? Math.max(1, Math.min(20, Math.trunc(body.k)))
        : undefined;

    const result = await askCorpus({ question, session, k });
    if (!result) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 503 }
      );
    }

    await writeAudit({
      userId: session.user.id,
      action: "ai.qa",
      resourceType: "AiQa",
      metadata: {
        question,
        citationCount: result.citations.length,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("AI QA failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
