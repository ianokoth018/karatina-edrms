import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

function serialise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialise(v);
    }
    return out;
  }
  return value;
}

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/bulk-import/jobs/[id] — job detail with a first page of items. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const __rateLimit = await enforceAdminRateLimit(req, session);
    if (__rateLimit) return __rateLimit;

    const { id } = await params;
    const job = await db.bulkImportJob.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ status: "asc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            sourcePath: true,
            documentId: true,
            status: true,
            error: true,
            bytes: true,
          },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(serialise({ job }));
  } catch (error) {
    logger.error("Failed to load bulk-import job", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/bulk-import/jobs/[id] — only supports `{ action: "cancel" }`.
 * Cancellation is co-operative: the worker checks job.status periodically
 * and stops at the next checkpoint.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const __rateLimit = await enforceAdminRateLimit(req, session);
    if (__rateLimit) return __rateLimit;

    const { id } = await params;
    const body = (await req.json()) as { action?: string };
    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const existing = await db.bulkImportJob.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status === "COMPLETED" || existing.status === "FAILED" || existing.status === "CANCELLED") {
      return NextResponse.json(
        { error: `Cannot cancel job in status ${existing.status}` },
        { status: 409 },
      );
    }

    const job = await db.bulkImportJob.update({
      where: { id },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });

    await writeAudit({
      userId: session.user.id,
      action: "bulk_import.job_cancelled",
      resourceType: "BulkImportJob",
      resourceId: id,
      metadata: { previousStatus: existing.status },
    });

    return NextResponse.json(serialise({ job }));
  } catch (error) {
    logger.error("Failed to cancel bulk-import job", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
