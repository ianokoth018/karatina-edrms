import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// GET /api/documents/[id]/signatures — list signatures for a document
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

    const signatures = await db.documentSignature.findMany({
      where: { documentId: id },
      include: {
        signer: {
          select: {
            id: true,
            name: true,
            displayName: true,
            department: true,
            jobTitle: true,
          },
        },
      },
      orderBy: { signedAt: "desc" },
    });

    return NextResponse.json({ signatures });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/documents/[id]/signatures — sign a document
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

    const { signatureType, signatureData, reason } = (await req.json()) as {
      signatureType: string;
      signatureData: string;
      reason?: string;
    };

    // Validate signatureType
    if (!["DRAWN", "TYPED", "UPLOADED"].includes(signatureType)) {
      return NextResponse.json(
        { error: "Invalid signature type. Must be DRAWN, TYPED, or UPLOADED." },
        { status: 400 }
      );
    }

    if (!signatureData?.trim()) {
      return NextResponse.json(
        { error: "Signature data is required" },
        { status: 400 }
      );
    }

    // Verify the document exists
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, createdById: true, title: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Get IP address from request headers
    const forwarded = req.headers.get("x-forwarded-for");
    const ipAddress = forwarded
      ? forwarded.split(",")[0].trim()
      : req.headers.get("x-real-ip") ?? undefined;

    // Get signer's job title for designation
    const designation = session.user.jobTitle || undefined;

    const signature = await db.documentSignature.create({
      data: {
        documentId: id,
        signerId: session.user.id,
        signatureType,
        signatureData: signatureData.trim(),
        reason: reason?.trim() || null,
        designation: designation || null,
        ipAddress: ipAddress || null,
      },
      include: {
        signer: {
          select: {
            id: true,
            name: true,
            displayName: true,
            department: true,
            jobTitle: true,
          },
        },
      },
    });

    // Notify document creator if signer is different
    if (doc.createdById !== session.user.id) {
      await db.notification.create({
        data: {
          userId: doc.createdById,
          type: "DOCUMENT_SIGNED",
          title: "Document Signed",
          body: `${session.user.name} signed "${doc.title}"${reason ? ` — ${reason}` : ""}`,
          linkUrl: `/documents/${id}`,
        },
      });
    }

    await writeAudit({
      userId: session.user.id,
      action: "document.sign",
      resourceType: "Document",
      resourceId: id,
      ipAddress: ipAddress || undefined,
      metadata: {
        signatureId: signature.id,
        signatureType,
        reason: reason || null,
      },
    });

    return NextResponse.json(signature, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
