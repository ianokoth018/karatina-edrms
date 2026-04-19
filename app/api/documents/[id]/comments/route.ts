import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// GET /api/documents/[id]/comments — list threaded comments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const comments = await db.documentComment.findMany({
      where: { documentId: id, parentId: null },
      include: {
        author: {
          select: { id: true, name: true, displayName: true, department: true },
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, displayName: true, department: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const total = await db.documentComment.count({ where: { documentId: id } });

    return NextResponse.json({ comments, total });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/documents/[id]/comments — add a comment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ipAddress =
      req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const { id } = await params;
    const { body, parentId } = (await req.json()) as {
      body: string;
      parentId?: string;
    };

    if (!body?.trim()) {
      return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
    }

    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, createdById: true, title: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const comment = await db.documentComment.create({
      data: {
        documentId: id,
        authorId: session.user.id,
        body: body.trim(),
        parentId: parentId || null,
      },
      include: {
        author: {
          select: { id: true, name: true, displayName: true, department: true },
        },
      },
    });

    // Notify document creator if commenter is different
    if (doc.createdById !== session.user.id) {
      await db.notification.create({
        data: {
          userId: doc.createdById,
          type: "DOCUMENT_COMMENT",
          title: "New Comment on Your Document",
          body: `${session.user.name} commented on "${doc.title}": ${body.trim().slice(0, 100)}`,
          linkUrl: `/documents/${id}`,
        },
      });
    }

    // If reply, notify parent comment author
    if (parentId) {
      const parent = await db.documentComment.findUnique({
        where: { id: parentId },
        select: { authorId: true },
      });
      if (parent && parent.authorId !== session.user.id && parent.authorId !== doc.createdById) {
        await db.notification.create({
          data: {
            userId: parent.authorId,
            type: "DOCUMENT_COMMENT",
            title: "Reply to Your Comment",
            body: `${session.user.name} replied to your comment on "${doc.title}"`,
            linkUrl: `/documents/${id}`,
          },
        });
      }
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.comment_added",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress ?? undefined,
      userAgent: userAgent ?? undefined,
      metadata: { commentId: comment.id, parentId },
    });

    return NextResponse.json(comment, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/documents/[id]/comments — resolve/edit a comment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await params; // consume params
    const { commentId, isResolved, body } = (await req.json()) as {
      commentId: string;
      isResolved?: boolean;
      body?: string;
    };

    if (!commentId) {
      return NextResponse.json({ error: "commentId is required" }, { status: 400 });
    }

    const comment = await db.documentComment.findUnique({ where: { id: commentId } });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // Only author can edit body
    if (body !== undefined && comment.authorId !== session.user.id) {
      return NextResponse.json({ error: "Only the author can edit this comment" }, { status: 403 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    if (isResolved !== undefined) data.isResolved = isResolved;
    if (body !== undefined) data.body = body.trim();

    const updated = await db.documentComment.update({
      where: { id: commentId },
      data,
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
