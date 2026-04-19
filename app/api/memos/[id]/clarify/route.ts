import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/memos/[id]/clarify — respond to a clarification request
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { response, requestEventId, attachmentIds } = (await req.json()) as {
      response: string;
      requestEventId?: string;
      attachmentIds?: string[];
    };

    if (!response?.trim()) {
      return NextResponse.json(
        { error: "Response is required" },
        { status: 400 }
      );
    }

    // Validate attachments belong to this memo's document
    let validAttachments: { id: string; fileName: string; mimeType: string; storagePath: string }[] = [];
    if (attachmentIds && attachmentIds.length > 0) {
      const memoDoc = await db.workflowInstance.findUnique({
        where: { id },
        select: { documentId: true },
      });
      if (memoDoc?.documentId) {
        validAttachments = await db.documentFile.findMany({
          where: { id: { in: attachmentIds }, documentId: memoDoc.documentId },
          select: { id: true, fileName: true, mimeType: true, storagePath: true },
        });
      }
    }

    // Fetch the memo
    const memo = await db.workflowInstance.findUnique({
      where: { id },
      select: { id: true, subject: true, initiatedById: true },
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    // Find the most recent clarification request targeting this user
    // (or a specific one if requestEventId is provided)
    const requestEvent = requestEventId
      ? await db.workflowEvent.findUnique({
          where: { id: requestEventId },
        })
      : await db.workflowEvent.findFirst({
          where: {
            instanceId: id,
            eventType: "MEMO_CLARIFICATION_REQUESTED",
          },
          orderBy: { occurredAt: "desc" },
        });

    if (!requestEvent) {
      return NextResponse.json(
        { error: "No clarification request found" },
        { status: 404 }
      );
    }

    const requestData = requestEvent.data as Record<string, unknown>;
    const requesterId = requestEvent.actorId;

    // Create clarification response event
    await db.workflowEvent.create({
      data: {
        instanceId: id,
        eventType: "MEMO_CLARIFICATION_PROVIDED",
        actorId: session.user.id,
        data: {
          actorName: session.user.name,
          requestEventId: requestEvent.id,
          requestedBy: String(requestData.actorName ?? ""),
          requestedById: requesterId ?? "",
          question: String(requestData.question ?? ""),
          response: response.trim(),
          attachments: validAttachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            storagePath: a.storagePath,
          })),
        },
      },
    });

    // Notify the person who requested clarification
    if (requesterId) {
      await db.notification.create({
        data: {
          userId: requesterId,
          type: "MEMO_CLARIFICATION_PROVIDED",
          title: "Clarification Provided",
          body: `${session.user.name} responded to your clarification request on memo "${memo.subject}": ${response.trim().slice(0, 100)}`,
          linkUrl: `/memos/${memo.id}`,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to respond to clarification", error, {
      route: "/api/memos/[id]/clarify",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
