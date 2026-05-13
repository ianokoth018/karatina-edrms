import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { buildDocumentAccessWhere } from "@/lib/document-access";
import { formatBatesNumber } from "@/lib/bates";

/**
 * POST /api/ediscovery/export
 * body: { documentIds: string[], format?: "concordance" | "relativity" }
 *
 * Streams a load-file (one row per document) so legal teams can hand the
 * production set to Concordance / Relativity / Logikcull review platforms.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { documentIds, format } = body as {
      documentIds: string[];
      format?: "concordance" | "relativity";
    };
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        { error: "documentIds[] is required" },
        { status: 400 }
      );
    }
    const accessWhere = await buildDocumentAccessWhere(session);
    const docs = await db.document.findMany({
      where: {
        AND: [{ id: { in: documentIds } }, accessWhere],
      },
      include: {
        createdBy: { select: { displayName: true, name: true, email: true } },
        bates: {
          include: { production: { include: { sequence: true } } },
          orderBy: { startNumber: "asc" },
          take: 1,
        },
        files: {
          orderBy: { uploadedAt: "asc" },
          take: 1,
          select: { storagePath: true, fileName: true },
        },
      },
    });

    // Concordance: tab-delimited. One row per document. Header on row 1.
    // Columns:
    //   BEGDOC | ENDDOC | TITLE | DOCTYPE | DEPARTMENT | CREATED | CUSTODIAN | NATIVE_PATH | TEXT_PATH
    const lines: string[] = [];
    lines.push(
      ["BEGDOC", "ENDDOC", "TITLE", "DOCTYPE", "DEPARTMENT", "CREATED", "CUSTODIAN", "NATIVE_PATH", "TEXT_PATH"].join("\t")
    );
    for (const d of docs) {
      const stamp = d.bates[0];
      const begDoc = stamp
        ? formatBatesNumber(stamp.production.sequence.prefix, stamp.production.sequence.pad, stamp.startNumber)
        : d.referenceNumber;
      const endDoc = stamp
        ? formatBatesNumber(stamp.production.sequence.prefix, stamp.production.sequence.pad, stamp.endNumber)
        : d.referenceNumber;
      const custodian = d.createdBy.displayName || d.createdBy.name || d.createdBy.email;
      const nativePath = d.files[0]?.storagePath ?? "";
      const cleanTitle = d.title.replace(/[\t\r\n]/g, " ");
      lines.push(
        [
          begDoc,
          endDoc,
          cleanTitle,
          d.documentType,
          d.department,
          d.createdAt.toISOString().slice(0, 10),
          custodian,
          nativePath,
          "", // no separate text file path for now
        ].join("\t")
      );
    }

    await writeAudit({
      userId: session.user.id,
      action: "ediscovery.load_file_exported",
      resourceType: "Production",
      metadata: {
        format: format ?? "concordance",
        documentCount: docs.length,
        documentIds: documentIds.slice(0, 50), // truncate metadata
      },
    });

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="production-${Date.now()}.dat"`,
      },
    });
  } catch (err) {
    logger.error("eDiscovery export failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
