import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

async function ensureOwnedDraft(id: string, userId: string) {
  const draft = await db.memoDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== userId) return null;
  return draft;
}

/**
 * GET /api/memos/drafts/[id] — load a draft for resume.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const draft = await ensureOwnedDraft(id, session.user.id);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json(draft);
  } catch (error) {
    logger.error("Failed to fetch memo draft", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/memos/drafts/[id] — autosave update.
 * Body: { subject?: string; payload: Record<string, unknown> }.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const draft = await ensureOwnedDraft(id, session.user.id);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      payload?: Record<string, unknown>;
    };
    const subject =
      typeof body.subject === "string" && body.subject.trim().length > 0
        ? body.subject.trim().slice(0, 200)
        : draft.subject;

    // If the draft was previously DocuSign-signed, check whether the
    // edit changed any content the signature actually covers (subject
    // or memoBody). If it did, invalidate the signed PDF so the
    // composer re-prompts to sign the latest version.
    let signatureInvalidation: {
      signedPdfPath: null;
      docusignEnvelopeId: null;
      docusignStatus: null;
      docusignSignedAt: null;
    } | undefined;
    if (draft.signedPdfPath) {
      const oldP = (draft.payload ?? {}) as Record<string, unknown>;
      const newP = (body.payload ?? {}) as Record<string, unknown>;
      const subjectChanged = (oldP.subject as string) !== (newP.subject as string);
      const bodyChanged = (oldP.memoBody as string) !== (newP.memoBody as string);
      const recipientChanged =
        JSON.stringify(oldP.recipient) !== JSON.stringify(newP.recipient) ||
        (oldP.manualTo as string) !== (newP.manualTo as string);
      if (subjectChanged || bodyChanged || recipientChanged) {
        try {
          const path = await import("path");
          const fs = await import("fs/promises");
          const abs = path.resolve(process.cwd(), draft.signedPdfPath);
          await fs.unlink(abs).catch(() => {});
        } catch {
          // best-effort cleanup
        }
        signatureInvalidation = {
          signedPdfPath: null,
          docusignEnvelopeId: null,
          docusignStatus: null,
          docusignSignedAt: null,
        };
      }
    }

    const updated = await db.memoDraft.update({
      where: { id },
      data: {
        subject,
        payload: (body.payload ?? {}) as Prisma.InputJsonValue,
        ...(signatureInvalidation ?? {}),
      },
      select: {
        id: true,
        subject: true,
        updatedAt: true,
        signedPdfPath: true,
        docusignStatus: true,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update memo draft", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/memos/drafts/[id] — discard a draft (manual delete or
 * called by the composer after a successful submit).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const draft = await ensureOwnedDraft(id, session.user.id);
    if (!draft) {
      return NextResponse.json({ ok: true });
    }
    await db.memoDraft.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to delete memo draft", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
