import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEffectiveDocumentPermissions } from "@/lib/document-permissions";
import { redactFile, type RedactionRegion } from "@/lib/redaction";
import { PDFDocument } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";

/**
 * Visual redaction endpoint.
 *
 * Accepts normalised (0–1) rectangles drawn by the user against the PDF
 * viewer's iframe and burns them into a fresh redacted copy of the PDF.
 *
 * Coordinate flow:
 *   client (top-left, 0–1)  →  server multiplies by page size in points
 *                              and flips Y to land on pdf-lib's
 *                              bottom-left coord system.
 *
 * Each region produces its own `DocumentRedaction` row + audit entry, all
 * pointing at the same `redactedPath` (a new file written per save).
 */

interface ClientRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

// GET /api/documents/[id]/redactions — list existing redactions in normalised form
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const perms = await getEffectiveDocumentPermissions(session, id);
  if (!perms.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db.documentRedaction.findMany({
    where: { documentId: id },
    select: {
      id: true,
      regions: true,
      reason: true,
      redactedPath: true,
      createdAt: true,
      createdBy: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Flatten to one entry per region for the canvas. Each row's `regions` is
  // JSON of `[{page, x, y, width, height, reason?, _norm?}]` — we tag normalised
  // payloads with `_norm: true` on write so the canvas can distinguish them
  // from legacy entries (which stored PDF points). Legacy entries are still
  // returned but with empty geometry so the canvas just ignores them.
  type StoredRegion = RedactionRegion & {
    _norm?: boolean;
    nx?: number;
    ny?: number;
    nw?: number;
    nh?: number;
  };
  const flat: Array<{
    id: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    reason: string | null;
    createdAt: string;
    createdBy: string | null;
  }> = [];
  for (const row of rows) {
    const regions = Array.isArray(row.regions)
      ? (row.regions as unknown as StoredRegion[])
      : [];
    regions.forEach((r, idx) => {
      const isNorm = r._norm === true;
      if (!isNorm) return;
      flat.push({
        id: `${row.id}:${idx}`,
        page: r.page,
        x: r.nx ?? 0,
        y: r.ny ?? 0,
        width: r.nw ?? 0,
        height: r.nh ?? 0,
        reason: r.reason ?? row.reason,
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdBy?.displayName ?? null,
      });
    });
  }

  return NextResponse.json({ redactions: flat });
}

// POST /api/documents/[id]/redactions
// Body: { redactions: ClientRegion[] }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const perms = await getEffectiveDocumentPermissions(session, id);
    if (!perms.canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as { redactions?: ClientRegion[] };
    const list = Array.isArray(body.redactions) ? body.redactions : [];
    if (list.length === 0) {
      return NextResponse.json(
        { error: "At least one redaction region is required" },
        { status: 400 },
      );
    }
    for (const r of list) {
      if (
        !Number.isFinite(r.page) ||
        r.page < 1 ||
        !Number.isFinite(r.x) ||
        !Number.isFinite(r.y) ||
        !Number.isFinite(r.width) ||
        !Number.isFinite(r.height) ||
        r.width <= 0 ||
        r.height <= 0 ||
        r.x < 0 ||
        r.y < 0 ||
        r.x + r.width > 1.001 ||
        r.y + r.height > 1.001
      ) {
        return NextResponse.json(
          { error: "Region out of bounds (must be 0–1)" },
          { status: 400 },
        );
      }
    }

    // Pick the PDF source — prefer rendition (already unencrypted) when the
    // primary file isn't PDF; otherwise use the primary file directly.
    const files = await db.documentFile.findMany({
      where: { documentId: id },
      select: {
        id: true,
        storagePath: true,
        renditionPath: true,
        renditionStatus: true,
        mimeType: true,
        encryptionIv: true,
        encryptionTag: true,
      },
      orderBy: { uploadedAt: "desc" },
    });
    if (files.length === 0) {
      return NextResponse.json(
        { error: "Document has no files" },
        { status: 404 },
      );
    }
    const primary = files[0];
    const usingRendition =
      primary.mimeType !== "application/pdf" &&
      primary.renditionStatus === "DONE" &&
      !!primary.renditionPath;
    const sourceRelPath = usingRendition
      ? primary.renditionPath!
      : primary.storagePath;
    if (
      !usingRendition &&
      primary.mimeType !== "application/pdf"
    ) {
      return NextResponse.json(
        { error: "Redaction requires a PDF or a PDF rendition" },
        { status: 400 },
      );
    }
    const sourceAbsPath = path.join(process.cwd(), sourceRelPath);

    // Load the source PDF to read page sizes (in points) so we can convert
    // the normalised client rects to PDF-space rectangles.
    let pdfBytes: Buffer;
    if (
      !usingRendition &&
      primary.encryptionIv &&
      primary.encryptionTag
    ) {
      const { decryptFileToBuffer } = await import("@/lib/encryption");
      pdfBytes = await decryptFileToBuffer(
        sourceAbsPath,
        primary.encryptionIv,
        primary.encryptionTag,
      );
    } else {
      pdfBytes = await fs.readFile(sourceAbsPath);
    }
    const probe = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageSizes = probe
      .getPages()
      .map((p) => ({ width: p.getWidth(), height: p.getHeight() }));

    // Convert each normalised region to PDF points.
    const pdfRegions: RedactionRegion[] = [];
    const storedRegions: Array<RedactionRegion & {
      _norm: true;
      nx: number;
      ny: number;
      nw: number;
      nh: number;
    }> = [];
    for (const r of list) {
      const pageIdx = r.page - 1;
      if (pageIdx < 0 || pageIdx >= pageSizes.length) continue;
      const { width: pw, height: ph } = pageSizes[pageIdx];
      const xPts = r.x * pw;
      const wPts = r.width * pw;
      const hPts = r.height * ph;
      // PDF Y origin is bottom-left; client Y origin is top-left.
      // The rectangle's top edge (client) is r.y; its bottom edge is r.y + r.height.
      // In PDF points the bottom-left Y is: ph - (r.y + r.height) * ph.
      const yPts = ph - (r.y + r.height) * ph;
      pdfRegions.push({
        page: r.page,
        x: xPts,
        y: yPts,
        width: wPts,
        height: hPts,
        reason: r.reason,
      });
      storedRegions.push({
        page: r.page,
        x: xPts,
        y: yPts,
        width: wPts,
        height: hPts,
        reason: r.reason,
        _norm: true,
        nx: r.x,
        ny: r.y,
        nw: r.width,
        nh: r.height,
      });
    }

    if (pdfRegions.length === 0) {
      return NextResponse.json(
        { error: "No valid regions after page bounds check" },
        { status: 400 },
      );
    }

    // Write the redacted PDF alongside the source.
    const ext = path.extname(sourceRelPath);
    const base = path.basename(sourceRelPath, ext);
    const redactedName = `${base}.redacted_${Date.now()}${ext}`;
    const redactedRelPath = sourceRelPath.replace(
      path.basename(sourceRelPath),
      redactedName,
    );
    const redactedAbsPath = path.join(process.cwd(), redactedRelPath);

    // Re-use the shared helper so file IO + encryption handling stays in
    // lib/redaction.ts. For the rendition we pass null encryption fields.
    await redactFile(
      sourceAbsPath,
      redactedAbsPath,
      pdfRegions,
      usingRendition ? null : primary.encryptionIv,
      usingRendition ? null : primary.encryptionTag,
    );

    // Bulk-create one DocumentRedaction row per region — the schema groups
    // by job but the spec asks for per-region rows + audit entries. All rows
    // share `redactedPath` so the burned file can still be served once.
    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const ua = req.headers.get("user-agent") ?? undefined;

    const created: { id: string; page: number }[] = [];
    for (const region of storedRegions) {
      const row = await db.documentRedaction.create({
        data: {
          documentId: id,
          fileId: primary.id,
          redactedPath: redactedRelPath,
          regions: [region] as unknown as Prisma.InputJsonValue,
          reason: region.reason ?? null,
          createdById: session.user.id,
        },
      });
      created.push({ id: row.id, page: region.page });
      await writeAudit({
        userId: session.user.id,
        action: "document.redacted",
        resourceType: "Document",
        resourceId: id,
        ipAddress: ip,
        userAgent: ua,
        metadata: {
          fileId: primary.id,
          redactionId: row.id,
          page: region.page,
          reason: region.reason,
          normalised: { x: region.nx, y: region.ny, w: region.nw, h: region.nh },
        },
      });
    }

    return NextResponse.json(
      {
        redactedPath: redactedRelPath,
        downloadUrl: `/api/files?path=${encodeURIComponent(redactedRelPath)}&download=1`,
        created,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Bulk redaction failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
