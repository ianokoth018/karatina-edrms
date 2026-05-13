import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { addDocumentsToMatter, removeDocumentFromMatter } from "@/lib/legal-hold";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/matters/[id]/documents — list documents on this matter. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const rows = await db.legalMatterDocument.findMany({
      where: { matterId: id },
      orderBy: { addedAt: "desc" },
      include: {
        document: {
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            documentType: true,
            isOnLegalHold: true,
          },
        },
      },
    });
    return NextResponse.json({ documents: rows });
  } catch (error) {
    logger.error("Failed to list matter documents", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** POST /api/admin/matters/[id]/documents — attach documents. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json()) as { documentIds?: string[] };
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.filter((d): d is string => typeof d === "string" && !!d)
      : [];
    if (documentIds.length === 0) {
      return NextResponse.json({ error: "documentIds is required" }, { status: 400 });
    }

    const added = await addDocumentsToMatter(id, documentIds, session.user.id);
    return NextResponse.json({ added });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    if (msg === "Cannot add documents to a closed matter" || msg === "Matter not found") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    logger.error("Failed to attach documents to matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/matters/[id]/documents — detach a document (?documentId=). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const documentId = new URL(req.url).searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }

    await removeDocumentFromMatter(id, documentId, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to detach document from matter", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
