import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";

type ExpiresIn = "1d" | "7d" | "30d" | "never";

function resolveBaseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXTAUTH_URL;
  if (envUrl && envUrl.length > 0) return envUrl.replace(/\/$/, "");
  // Fall back to the request origin when NEXTAUTH_URL is not set.
  return req.nextUrl.origin;
}

function computeExpiresAt(expiresIn: ExpiresIn): Date | null {
  const now = Date.now();
  switch (expiresIn) {
    case "1d":
      return new Date(now + 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now + 30 * 24 * 60 * 60 * 1000);
    case "never":
      return null;
    default:
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * POST /api/documents/[id]/share-link — create a tokenised external share link.
 *
 * The token is a 32-byte crypto.randomBytes value (base64url-encoded) — never
 * Math.random. Optionally sends an email with the viewer URL via an inline
 * Correspondence record mirroring /api/email/outbound.
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
      email,
      canDownload = false,
      canPrint = false,
      expiresIn = "7d",
      sendEmail,
    } = body as {
      email?: string;
      canDownload?: boolean;
      canPrint?: boolean;
      expiresIn?: ExpiresIn;
      sendEmail?: boolean;
    };

    if (!["1d", "7d", "30d", "never"].includes(expiresIn)) {
      return NextResponse.json(
        { error: "expiresIn must be one of: 1d, 7d, 30d, never" },
        { status: 400 }
      );
    }

    // Permission check.
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

    const token = randomBytes(32).toString("base64url");
    const expiresAt = computeExpiresAt(expiresIn);

    const link = await db.documentShareLink.create({
      data: {
        documentId,
        token,
        email: email?.trim() || null,
        createdById: session.user.id,
        canDownload: Boolean(canDownload),
        canPrint: Boolean(canPrint),
        expiresAt,
      },
    });

    const baseUrl = resolveBaseUrl(req);
    const viewerUrl = `${baseUrl}/shared/${token}`;

    // Default: send if an email was provided, unless explicitly disabled.
    const shouldEmail =
      link.email && (sendEmail === undefined ? true : sendEmail !== false);

    if (shouldEmail && link.email) {
      try {
        const actor =
          session.user.name || session.user.email || "A colleague";
        const subject = `${actor} shared a document with you`;
        const expiryNote = expiresAt
          ? `This link expires on ${expiresAt.toUTCString()}.`
          : "This link does not expire.";
        const textBody = [
          `${actor} has shared a document with you via a secure link.`,
          ``,
          `Title: ${document.title}`,
          `Reference: ${document.referenceNumber}`,
          `Open: ${viewerUrl}`,
          ``,
          expiryNote,
          canDownload ? "You may download this document." : null,
          canPrint ? "You may print this document." : null,
        ]
          .filter(Boolean)
          .join("\n");

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
            toEntity: link.email,
            dateSent: new Date(),
            status: "CLOSED",
            priority: "NORMAL",
            dispatchMethod: "EMAIL",
            description: textBody.slice(0, 500),
            documentId: document.id,
            createdById: session.user.id,
            metadata: {
              emailTo: link.email,
              emailSubject: subject,
              emailBody: textBody,
              emailHtml: "",
              sentBy: session.user.name,
              sentAt: new Date().toISOString(),
              shareLinkId: link.id,
              viewerUrl,
            },
          },
        });
      } catch (err) {
        logger.error("Failed to send share-link email", err, {
          linkId: link.id,
          documentId,
        });
      }
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.share_link_created",
      resourceType: "Document",
      resourceId: documentId,
      metadata: {
        linkId: link.id,
        email: link.email,
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        canDownload: link.canDownload,
        canPrint: link.canPrint,
      },
    });

    logger.info("Document share link created", {
      userId: session.user.id,
      documentId,
      linkId: link.id,
    });

    return NextResponse.json(
      {
        id: link.id,
        token: link.token,
        url: viewerUrl,
        expiresAt: link.expiresAt,
        canDownload: link.canDownload,
        canPrint: link.canPrint,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Failed to create share link", error, {
      route: "/api/documents/[id]/share-link",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/documents/[id]/share-link — list active (non-revoked, non-expired)
 * share links for this document. Requires canShare.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: documentId } = await params;

    const perms = await getEffectiveDocumentPermissions(session, documentId);
    if (!perms.canShare) {
      return NextResponse.json(
        { error: "You do not have permission to view share links" },
        { status: 403 }
      );
    }

    const now = new Date();
    const links = await db.documentShareLink.findMany({
      where: {
        documentId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        createdAt: true,
        expiresAt: true,
        accessCount: true,
        lastAccessAt: true,
        canDownload: true,
        canPrint: true,
      },
    });

    return NextResponse.json(links);
  } catch (error) {
    logger.error("Failed to list share links", error, {
      route: "/api/documents/[id]/share-link",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
