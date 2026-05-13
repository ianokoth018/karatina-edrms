import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import { createDocEmbedToken } from "@/lib/embed-token";
import { logger } from "@/lib/logger";

/**
 * POST /api/documents/[id]/embed-token
 * Mint a short-lived (15 min) signed token granting the caller permission
 * to render the document inside an iframe via /embed/doc/[id]?token=...
 *
 * The mint endpoint runs the same read-access check the document detail
 * route does — once the token is issued, the embed page trusts it without
 * an additional DB lookup so it can be loaded cross-origin.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const access = await buildDocumentAccessWhere(session);
    const doc = await db.document.findFirst({
      where: { AND: [{ id }, access] },
      select: { id: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { token, expiresAt } = createDocEmbedToken(id, session.user.id);
    return NextResponse.json({ token, expiresAt });
  } catch (error) {
    logger.error("Failed to mint embed token", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
