import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/disposition/certificate — list certificates
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
    );
    const statusFilter = searchParams.get("status"); // DRAFT, APPROVED, EXECUTED

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (statusFilter && ["DRAFT", "APPROVED", "EXECUTED"].includes(statusFilter)) {
      where.status = statusFilter;
    }

    const [certificates, total] = await Promise.all([
      db.dispositionCertificate.findMany({
        where,
        include: {
          approvedBy: {
            select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
          },
          witness: {
            select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dispositionCertificate.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      certificates,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    logger.error("Failed to list disposition certificates", error, {
      route: "/api/records/disposition/certificate",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/disposition/certificate — create new certificate
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { documentIds, disposalMethod, disposalDate, remarks, witnessId } = body as {
      documentIds: string[];
      disposalMethod: string;
      disposalDate: string;
      remarks?: string;
      witnessId?: string;
    };

    // Validate
    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        { error: "documentIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const validMethods = ["SHREDDING", "INCINERATION", "DIGITAL_DELETION", "RECYCLING"];
    if (!disposalMethod || !validMethods.includes(disposalMethod)) {
      return NextResponse.json(
        { error: `disposalMethod must be one of: ${validMethods.join(", ")}` },
        { status: 400 }
      );
    }

    if (!disposalDate) {
      return NextResponse.json(
        { error: "disposalDate is required" },
        { status: 400 }
      );
    }

    // Verify documents exist
    const documents = await db.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true },
    });

    if (documents.length === 0) {
      return NextResponse.json(
        { error: "No matching documents found" },
        { status: 404 }
      );
    }

    // Verify witness if provided
    if (witnessId) {
      const witness = await db.user.findUnique({ where: { id: witnessId } });
      if (!witness) {
        return NextResponse.json(
          { error: "Witness user not found" },
          { status: 404 }
        );
      }
    }

    // Generate certificate number: DC-{year}-{sequence}
    const year = new Date().getFullYear();
    const prefix = `DC-${year}-`;

    const lastCert = await db.dispositionCertificate.findFirst({
      where: {
        certificateNo: { startsWith: prefix },
      },
      orderBy: { certificateNo: "desc" },
      select: { certificateNo: true },
    });

    let sequence = 1;
    if (lastCert) {
      const parts = lastCert.certificateNo.split("-");
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    const certificateNo = `${prefix}${sequence.toString().padStart(4, "0")}`;

    const certificate = await db.dispositionCertificate.create({
      data: {
        certificateNo,
        disposalDate: new Date(disposalDate),
        disposalMethod,
        approvedById: session.user.id,
        witnessId: witnessId || null,
        documentIds: documentIds,
        documentCount: documents.length,
        remarks: remarks?.trim() || null,
        status: "DRAFT",
      },
      include: {
        approvedBy: {
          select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
        },
        witness: {
          select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "disposition.certificate.created",
      resourceType: "DispositionCertificate",
      resourceId: certificate.id,
      metadata: {
        certificateNo,
        documentCount: documents.length,
        disposalMethod,
      },
    });

    logger.info("Disposition certificate created", {
      userId: session.user.id,
      action: "disposition.certificate.created",
      route: "/api/records/disposition/certificate",
      method: "POST",
    });

    return NextResponse.json(certificate, { status: 201 });
  } catch (error) {
    logger.error("Failed to create disposition certificate", error, {
      route: "/api/records/disposition/certificate",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/records/disposition/certificate — update certificate status
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { certificateId, status } = body as {
      certificateId: string;
      status: string;
    };

    if (!certificateId) {
      return NextResponse.json(
        { error: "certificateId is required" },
        { status: 400 }
      );
    }

    if (!status || !["APPROVED", "EXECUTED"].includes(status)) {
      return NextResponse.json(
        { error: "status must be APPROVED or EXECUTED" },
        { status: 400 }
      );
    }

    const certificate = await db.dispositionCertificate.findUnique({
      where: { id: certificateId },
    });

    if (!certificate) {
      return NextResponse.json(
        { error: "Certificate not found" },
        { status: 404 }
      );
    }

    // Validate transition: DRAFT -> APPROVED -> EXECUTED
    if (status === "APPROVED" && certificate.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Can only approve a DRAFT certificate" },
        { status: 400 }
      );
    }

    if (status === "EXECUTED" && certificate.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Can only execute an APPROVED certificate" },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { status };

    // On EXECUTED: update all documents to DISPOSED and set executedAt
    if (status === "EXECUTED") {
      updateData.executedAt = new Date();

      const docIds = certificate.documentIds as string[];
      if (docIds && docIds.length > 0) {
        await db.document.updateMany({
          where: { id: { in: docIds } },
          data: { status: "DISPOSED" },
        });
      }
    }

    const updated = await db.dispositionCertificate.update({
      where: { id: certificateId },
      data: updateData,
      include: {
        approvedBy: {
          select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
        },
        witness: {
          select: { id: true, name: true, displayName: true, jobTitle: true, department: true },
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: `disposition.certificate.${status.toLowerCase()}`,
      resourceType: "DispositionCertificate",
      resourceId: certificate.id,
      metadata: {
        certificateNo: certificate.certificateNo,
        previousStatus: certificate.status,
        newStatus: status,
        documentCount: certificate.documentCount,
      },
    });

    logger.info(`Disposition certificate ${status.toLowerCase()}`, {
      userId: session.user.id,
      action: `disposition.certificate.${status.toLowerCase()}`,
      route: "/api/records/disposition/certificate",
      method: "PATCH",
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to update disposition certificate", error, {
      route: "/api/records/disposition/certificate",
      method: "PATCH",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
