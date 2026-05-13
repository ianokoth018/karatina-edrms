import { NextRequest, NextResponse } from "next/server";
import type { DisposalAction } from "@prisma/client";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { proposeDispositionCertificate } from "@/lib/retention-disposition";

const VALID_ACTIONS: DisposalAction[] = ["DESTROY", "ARCHIVE_PERMANENT", "REVIEW"];
const VALID_STATUS = new Set(["DRAFT", "APPROVED", "EXECUTED", "NEEDS_REVIEW"]);

/** GET /api/admin/disposition/certificates — list certs (admin / dispose). */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const perms = (session.user.permissions as string[] | undefined) ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("records:dispose")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(searchParams.get("limit") ?? "50", 10)),
    );
    const status = searchParams.get("status");

    const where: { status?: string } = {};
    if (status && VALID_STATUS.has(status)) where.status = status;

    const [certificates, total] = await Promise.all([
      db.dispositionCertificate.findMany({
        where,
        include: {
          approvedBy: {
            select: { id: true, displayName: true, email: true, department: true },
          },
          witness: {
            select: { id: true, displayName: true, email: true, department: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.dispositionCertificate.count({ where }),
    ]);

    return NextResponse.json({
      certificates,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error("List disposition certificates failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** POST /api/admin/disposition/certificates — manually propose a cert. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const perms = (session.user.permissions as string[] | undefined) ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("records:dispose")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      documentIds?: unknown;
      action?: unknown;
      remarks?: unknown;
    };
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.filter((v): v is string => typeof v === "string")
      : [];
    if (documentIds.length === 0) {
      return NextResponse.json(
        { error: "documentIds must be a non-empty array of strings" },
        { status: 400 },
      );
    }
    const action =
      typeof body.action === "string" &&
      VALID_ACTIONS.includes(body.action as DisposalAction)
        ? (body.action as DisposalAction)
        : undefined;
    const remarks =
      typeof body.remarks === "string" && body.remarks.trim().length > 0
        ? body.remarks.trim()
        : undefined;

    const cert = await proposeDispositionCertificate(documentIds, session.user.id, {
      action,
      remarks,
    });
    return NextResponse.json(cert, { status: 201 });
  } catch (error) {
    logger.error("Propose disposition certificate failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
