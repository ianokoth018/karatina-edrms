import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { allocateBatesRange, countPdfPages, stampPdfPages } from "@/lib/bates";

function adminGate(session: { user?: { permissions?: string[] } } | null) {
  if (!session?.user) return { ok: false, status: 401 as const };
  if (!session.user.permissions?.includes("admin:manage"))
    return { ok: false, status: 403 as const };
  return { ok: true as const };
}

export async function GET() {
  const session = await auth();
  const gate = adminGate(session);
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  const productions = await db.batesProduction.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      sequence: { select: { id: true, name: true, prefix: true, pad: true } },
      _count: { select: { stamps: true } },
    },
  });
  return NextResponse.json({ productions });
}

/**
 * POST /api/bates/productions
 * body: { sequenceId, name, documentIds: string[] }
 *
 * Runs a stamping production: for each document, count pages, allocate
 * Bates numbers, stamp a PDF copy, write a BatesStamp row.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const gate = adminGate(session);
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const body = await req.json();
    const { sequenceId, name, documentIds } = body as {
      sequenceId: string;
      name: string;
      documentIds: string[];
    };
    if (!sequenceId || !name?.trim() || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        { error: "sequenceId, name, and documentIds[] are required" },
        { status: 400 }
      );
    }
    const sequence = await db.batesSequence.findUnique({
      where: { id: sequenceId },
    });
    if (!sequence) {
      return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    }
    const production = await db.batesProduction.create({
      data: {
        sequenceId,
        name: name.trim(),
        startNumber: sequence.nextValue,
        createdById: session!.user!.id!,
      },
    });

    const outputRoot = path.join(process.cwd(), "uploads", "bates", production.id);
    await fs.mkdir(outputRoot, { recursive: true });

    let documentCount = 0;
    let pageTotal = 0;
    const stamps: { documentId: string; start: number; end: number; pageCount: number }[] = [];
    const skipped: string[] = [];

    for (const documentId of documentIds) {
      // Already stamped within this production? Unique (productionId, documentId) skips.
      const file = await db.documentFile.findFirst({
        where: { documentId },
        orderBy: [{ isArchival: "asc" }, { uploadedAt: "asc" }],
      });
      if (!file) {
        skipped.push(documentId);
        continue;
      }
      const usePath = file.renditionStatus === "DONE" && file.renditionPath
        ? file.renditionPath
        : file.storagePath;
      const absPath = path.join(process.cwd(), usePath);
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(absPath);
      } catch {
        skipped.push(documentId);
        continue;
      }

      let pageCount = 0;
      try {
        pageCount = await countPdfPages(bytes);
      } catch {
        skipped.push(documentId);
        continue;
      }
      if (pageCount === 0) {
        skipped.push(documentId);
        continue;
      }

      const range = await allocateBatesRange(sequenceId, pageCount);
      const stamped = await stampPdfPages(
        bytes,
        sequence.prefix,
        sequence.pad,
        range.start
      );
      const stampedPath = path.join(outputRoot, `${documentId}.pdf`);
      await fs.writeFile(stampedPath, stamped);

      await db.batesStamp.create({
        data: {
          productionId: production.id,
          documentId,
          startNumber: range.start,
          endNumber: range.end,
          pageCount,
          stampedPath: path.relative(process.cwd(), stampedPath),
        },
      });

      stamps.push({ documentId, start: range.start, end: range.end, pageCount });
      documentCount += 1;
      pageTotal += pageCount;
    }

    const updated = await db.batesProduction.update({
      where: { id: production.id },
      data: {
        endNumber: stamps.length > 0 ? stamps[stamps.length - 1].end : production.startNumber - 1,
        documentCount,
        pageCount: pageTotal,
      },
    });

    await writeAudit({
      userId: session!.user!.id!,
      action: "bates.production_run",
      resourceType: "BatesProduction",
      resourceId: production.id,
      metadata: {
        sequenceId,
        documentCount,
        pageCount: pageTotal,
        skippedCount: skipped.length,
      },
    });

    return NextResponse.json({
      production: updated,
      stamps,
      skipped,
    });
  } catch (err) {
    logger.error("Bates production failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
