import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/physical -- List physical records with pagination & filters
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip = (page - 1) * limit;

    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const location = searchParams.get("location");

    // Build Prisma where clause
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (location) {
      where.shelfLocation = { contains: location, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
        { boxNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const [records, total] = await Promise.all([
      db.physicalRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { movements: true },
          },
        },
      }),
      db.physicalRecord.count({ where }),
    ]);

    return NextResponse.json({
      records: records.map((r) => ({
        ...r,
        movementCount: r._count.movements,
        _count: undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Failed to list physical records", error, {
      route: "/api/records/physical",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/records/physical -- Create a new physical record
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { title, boxNumber, shelfLocation, offSiteLocation, barcode, documentId } = body as {
      title?: string;
      boxNumber?: string;
      shelfLocation?: string;
      offSiteLocation?: string;
      barcode?: string;
      documentId?: string;
    };

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Check barcode uniqueness if provided
    if (barcode) {
      const existing = await db.physicalRecord.findUnique({ where: { barcode } });
      if (existing) {
        return NextResponse.json(
          { error: "A record with this barcode already exists" },
          { status: 409 },
        );
      }
    }

    // Auto-generate reference number: PHY-{sequence}
    const lastRecord = await db.physicalRecord.findFirst({
      where: { referenceNumber: { startsWith: "PHY-" } },
      orderBy: { createdAt: "desc" },
      select: { referenceNumber: true },
    });

    let nextSequence = 1;
    if (lastRecord) {
      const match = lastRecord.referenceNumber.match(/^PHY-(\d+)$/);
      if (match) {
        nextSequence = parseInt(match[1], 10) + 1;
      }
    }

    const referenceNumber = `PHY-${String(nextSequence).padStart(5, "0")}`;

    const record = await db.physicalRecord.create({
      data: {
        referenceNumber,
        title: title.trim(),
        boxNumber: boxNumber?.trim() || null,
        shelfLocation: shelfLocation?.trim() || null,
        offSiteLocation: offSiteLocation?.trim() || null,
        barcode: barcode?.trim() || null,
        documentId: documentId?.trim() || null,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "physical_record.create",
      resourceType: "PhysicalRecord",
      resourceId: record.id,
      metadata: {
        referenceNumber: record.referenceNumber,
        title: record.title,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    logger.error("Failed to create physical record", error, {
      route: "/api/records/physical",
      method: "POST",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
