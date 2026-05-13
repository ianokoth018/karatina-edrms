import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

/** Custom serialiser — Prisma BigInt fields don't survive JSON.stringify. */
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

/** GET /api/admin/bulk-import/jobs — list every job, newest first. */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const __rateLimit = await enforceAdminRateLimit(req, session);
    if (__rateLimit) return __rateLimit;

    const jobs = await db.bulkImportJob.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourcePath: true,
        status: true,
        totalFiles: true,
        processedFiles: true,
        skippedFiles: true,
        failedFiles: true,
        department: true,
        documentType: true,
        tagsCsv: true,
        startedAt: true,
        finishedAt: true,
        error: true,
        createdById: true,
        createdAt: true,
      },
    });

    return NextResponse.json(serialise({ jobs }));
  } catch (error) {
    logger.error("Failed to list bulk-import jobs", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/bulk-import/jobs — create a new job. Validates that the
 * sourcePath exists and is a readable directory before enqueueing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const __rateLimit = await enforceAdminRateLimit(req, session);
    if (__rateLimit) return __rateLimit;

    const body = (await req.json()) as {
      name?: string;
      sourcePath?: string;
      department?: string;
      documentType?: string;
      tagsCsv?: string;
    };

    const name = (body.name ?? "").trim();
    const sourcePath = (body.sourcePath ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!sourcePath) return NextResponse.json({ error: "sourcePath is required" }, { status: 400 });
    if (!path.isAbsolute(sourcePath)) {
      return NextResponse.json(
        { error: "sourcePath must be an absolute path" },
        { status: 400 },
      );
    }

    try {
      const stat = await fs.stat(sourcePath);
      if (!stat.isDirectory()) {
        return NextResponse.json(
          { error: "sourcePath is not a directory" },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "sourcePath does not exist or is not readable" },
        { status: 400 },
      );
    }

    const job = await db.bulkImportJob.create({
      data: {
        name,
        sourcePath,
        department: body.department?.trim() || null,
        documentType: (body.documentType?.trim() || "OTHER").toUpperCase(),
        tagsCsv: body.tagsCsv?.trim() || null,
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "bulk_import.job_created",
      resourceType: "BulkImportJob",
      resourceId: job.id,
      metadata: { name, sourcePath, department: job.department, documentType: job.documentType },
    });

    return NextResponse.json(serialise({ job }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create bulk-import job", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
