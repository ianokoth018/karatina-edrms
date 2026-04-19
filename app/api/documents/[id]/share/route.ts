import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

type AccessLevel = "viewer" | "editor" | "full";

interface LevelFlags {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canShare: boolean;
  canPrint: boolean;
}

/**
 * Map a share-level to a DAC flag set.
 * OR-merging on upsert means levels only ever widen existing permissions.
 */
function levelToFlags(level: AccessLevel): LevelFlags {
  switch (level) {
    case "editor":
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canShare: false,
        canPrint: true,
      };
    case "full":
      return {
        canRead: true,
        canWrite: true,
        canDelete: true,
        canShare: true,
        canPrint: true,
      };
    case "viewer":
    default:
      return {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canShare: false,
        canPrint: false,
      };
  }
}

/**
 * POST /api/documents/[id]/share — share a document with one or more in-system users.
 *
 * Upserts DocumentAccessControl rows (OR-merges flags so an existing broader
 * grant is never narrowed), sends a DOCUMENT_SHARED notification to each
 * recipient, and optionally tracks an outgoing Correspondence record per
 * recipient to mirror the existing /api/email/outbound behaviour.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: documentId } = await params;

    const body = await req.json().catch(() => ({}));
    const {
      userIds,
      accessLevel = "viewer",
      message,
      sendEmail = true,
    } = body as {
      userIds?: unknown;
      accessLevel?: AccessLevel;
      message?: string;
      sendEmail?: boolean;
    };

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: "userIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const recipientIds = Array.from(
      new Set(
        userIds.filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        )
      )
    );

    if (recipientIds.length === 0) {
      return NextResponse.json(
        { error: "userIds must contain at least one valid user id" },
        { status: 400 }
      );
    }

    if (!["viewer", "editor", "full"].includes(accessLevel)) {
      return NextResponse.json(
        { error: "accessLevel must be one of: viewer, editor, full" },
        { status: 400 }
      );
    }

    // Permission check — only users with share rights can share.
    const perms = await getEffectiveDocumentPermissions(session, documentId);
    if (!perms.canShare) {
      return NextResponse.json(
        { error: "You do not have permission to share this document" },
        { status: 403 }
      );
    }

    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, referenceNumber: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const recipients = await db.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, email: true, displayName: true, name: true },
    });

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "No matching users found" },
        { status: 404 }
      );
    }

    const flags = levelToFlags(accessLevel);
    const senderName =
      session.user.name || session.user.email || "A colleague";

    const shared: { userId: string; accessLevel: AccessLevel }[] = [];
    let notificationsSent = 0;
    let emailsSent = 0;

    for (const recipient of recipients) {
      // Upsert DAC row — OR-merge existing flags so we never narrow a grant.
      const existing = await db.documentAccessControl.findFirst({
        where: { documentId, userId: recipient.id },
      });

      if (existing) {
        await db.documentAccessControl.update({
          where: { id: existing.id },
          data: {
            canRead: existing.canRead || flags.canRead,
            canWrite: existing.canWrite || flags.canWrite,
            canDelete: existing.canDelete || flags.canDelete,
            canShare: existing.canShare || flags.canShare,
            canPrint: existing.canPrint || flags.canPrint,
          },
        });
      } else {
        await db.documentAccessControl.create({
          data: {
            documentId,
            userId: recipient.id,
            ...flags,
          },
        });
      }

      shared.push({ userId: recipient.id, accessLevel });

      // In-app notification
      const notifBody = [
        `${senderName} shared "${document.title}" with you.`,
        message ? `Message: ${message}` : null,
      ]
        .filter(Boolean)
        .join(" ");

      try {
        await db.notification.create({
          data: {
            userId: recipient.id,
            type: "DOCUMENT_SHARED",
            title: "Document shared with you",
            body: notifBody,
            linkUrl: `/documents/${document.id}`,
            sentEmail: false,
          },
        });
        notificationsSent += 1;
      } catch (err) {
        logger.error("Failed to create share notification", err, {
          recipientId: recipient.id,
          documentId,
        });
      }

      // Optional outgoing email — inline-create a Correspondence record to
      // mirror /api/email/outbound without needing an internal fetch.
      if (sendEmail !== false && recipient.email) {
        try {
          const subject = `Document shared: ${document.title}`;
          const textBody = [
            `${senderName} has shared a document with you.`,
            ``,
            `Title: ${document.title}`,
            `Reference: ${document.referenceNumber}`,
            `Open: /documents/${document.id}`,
            message ? `\nMessage:\n${message}` : "",
          ]
            .join("\n")
            .trim();

          const year = new Date().getFullYear();
          const corrCount = await db.correspondence.count({
            where: {
              referenceNumber: { startsWith: `CORR/OUT/${year}/` },
            },
          });
          const corrRef = `CORR/OUT/${year}/${corrCount + 1}`;

          await db.correspondence.create({
            data: {
              type: "OUTGOING",
              referenceNumber: corrRef,
              subject,
              fromEntity: session.user.department || "EDRMS",
              toEntity: recipient.email,
              dateSent: new Date(),
              status: "CLOSED",
              priority: "NORMAL",
              dispatchMethod: "EMAIL",
              description: textBody.slice(0, 500),
              documentId: document.id,
              createdById: session.user.id,
              metadata: {
                emailTo: recipient.email,
                emailSubject: subject,
                emailBody: textBody,
                emailHtml: "",
                sentBy: session.user.name,
                sentAt: new Date().toISOString(),
                shareContext: {
                  recipientUserId: recipient.id,
                  accessLevel,
                },
              },
            },
          });
          emailsSent += 1;
        } catch (err) {
          logger.error("Failed to send share email", err, {
            recipientId: recipient.id,
            documentId,
          });
        }
      }
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.shared_internal",
      resourceType: "Document",
      resourceId: documentId,
      metadata: {
        recipients: shared.map((s) => s.userId),
        accessLevel,
        sendEmail: sendEmail !== false,
        notificationsSent,
        emailsSent,
      },
    });

    logger.info("Document shared with internal users", {
      userId: session.user.id,
      documentId,
      recipientCount: shared.length,
      accessLevel,
    });

    return NextResponse.json({
      shared,
      notificationsSent,
      emailsSent,
    });
  } catch (error) {
    logger.error("Failed to share document", error, {
      route: "/api/documents/[id]/share",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
