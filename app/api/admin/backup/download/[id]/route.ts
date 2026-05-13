import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";
import path from "path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";

/**
 * GET /api/admin/backup/download/[id]?artefact=db|uploads
 *
 * Streams the requested artefact (Postgres dump or uploads tarball) for
 * a BackupLog row. Admin-only. Every download is audited (action:
 * `backup.download`) so the trail makes it obvious if a dump leaves the
 * server.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.permissions?.includes("admin:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rateLimited = await enforceAdminRateLimit(req, session);
  if (rateLimited) return rateLimited;

  const { id } = await params;
  const artefactParam = new URL(req.url).searchParams.get("artefact") ?? "db";
  if (artefactParam !== "db" && artefactParam !== "uploads") {
    return NextResponse.json(
      { error: "artefact must be 'db' or 'uploads'" },
      { status: 400 }
    );
  }

  const row = await db.backupLog.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = artefactParam === "db" ? row.dbDumpPath : row.uploadsPath;
  if (!filePath) {
    return NextResponse.json(
      { error: `No ${artefactParam} artefact for this backup` },
      { status: 404 }
    );
  }

  // Guard against any future bug that lets a relative path slip in.
  const resolved = path.resolve(filePath);

  let size = 0;
  try {
    size = statSync(resolved).size;
  } catch (err) {
    logger.warn("backup.download: file missing on disk", {
      backupLogId: id,
      filePath: resolved,
      code: (err as NodeJS.ErrnoException).code,
    });
    return NextResponse.json(
      { error: "Artefact missing on disk (likely pruned)" },
      { status: 410 }
    );
  }

  await writeAudit({
    userId: session.user.id as string,
    action: "backup.download",
    resourceType: "backup",
    resourceId: id,
    metadata: { artefact: artefactParam, filePath: resolved, size },
  });

  // Bridge Node stream → Web Response. Next 16 happily accepts a
  // ReadableStream (Web) here; Readable.toWeb does the conversion.
  const nodeStream = createReadStream(resolved);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  const filename = path.basename(resolved);
  const contentType =
    artefactParam === "db" ? "application/octet-stream" : "application/gzip";

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
