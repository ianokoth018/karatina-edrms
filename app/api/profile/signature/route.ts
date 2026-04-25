import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "signatures");
const STAMP_DIR = path.join(process.cwd(), "uploads", "stamps");
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const MAX_BYTES = 1 * 1024 * 1024; // 1 MiB — signatures should be small

interface UploadBody {
  /** A `data:image/png;base64,...` string from the in-browser canvas. */
  dataUrl?: string;
  /** Which kind of asset this is. */
  kind?: "signature" | "stamp";
}

function dirFor(kind: "signature" | "stamp"): string {
  return kind === "stamp" ? STAMP_DIR : UPLOAD_DIR;
}

function fieldFor(kind: "signature" | "stamp"): "signatureImage" | "officeStamp" {
  return kind === "stamp" ? "officeStamp" : "signatureImage";
}

/**
 * POST /api/profile/signature
 *
 * Two ingestion modes:
 *  - multipart/form-data with `file` field (image/png|jpeg|webp ≤ 1 MiB)
 *  - application/json with `{ dataUrl: "data:image/png;base64,..." }` —
 *    used by the in-browser signature canvas.
 *
 * Optional `?kind=stamp` URL param (or JSON body field) to upload an
 * office stamp instead of a personal signature. Both end up under
 * uploads/{signatures|stamps}/{userId}.png.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const queryKind = req.nextUrl.searchParams.get("kind");
    let kind: "signature" | "stamp" =
      queryKind === "stamp" ? "stamp" : "signature";

    let bytes: Buffer;
    let ext = "png";
    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      const body = (await req.json()) as UploadBody;
      if (body.kind === "stamp") kind = "stamp";
      const dataUrl = body.dataUrl ?? "";
      const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
      if (!m) {
        return NextResponse.json(
          { error: "Invalid dataUrl — must be a base64-encoded PNG/JPEG/WebP" },
          { status: 400 },
        );
      }
      bytes = Buffer.from(m[3], "base64");
      ext = m[2] === "jpg" ? "jpg" : m[2];
    } else {
      const form = await req.formData();
      const file = form.get("file");
      const formKind = form.get("kind");
      if (formKind === "stamp") kind = "stamp";
      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: "Provide a file or dataUrl" },
          { status: 400 },
        );
      }
      if (!ALLOWED_MIME.has(file.type)) {
        return NextResponse.json(
          { error: "Only PNG, JPEG, or WebP images are allowed" },
          { status: 415 },
        );
      }
      const buf = await file.arrayBuffer();
      bytes = Buffer.from(buf);
      ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    }

    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `Maximum file size is ${MAX_BYTES / (1024 * 1024)} MiB` },
        { status: 413 },
      );
    }

    const targetDir = dirFor(kind);
    await fs.mkdir(targetDir, { recursive: true });

    // Wipe any prior asset with this user's id (any extension)
    try {
      const existing = await fs.readdir(targetDir);
      await Promise.all(
        existing
          .filter((f) => f.startsWith(`${userId}.`))
          .map((f) => fs.unlink(path.join(targetDir, f)).catch(() => null)),
      );
    } catch {
      /* ignore */
    }

    const filename = `${userId}.${ext}`;
    await fs.writeFile(path.join(targetDir, filename), bytes);

    const relPath = path.posix.join(
      "uploads",
      kind === "stamp" ? "stamps" : "signatures",
      filename,
    );

    await db.user.update({
      where: { id: userId },
      data: {
        [fieldFor(kind)]: relPath,
        ...(kind === "signature" ? { signatureUploadedAt: new Date() } : {}),
      },
    });

    await writeAudit({
      userId,
      action: kind === "stamp" ? "USER_STAMP_UPLOADED" : "USER_SIGNATURE_UPLOADED",
      resourceType: "user",
      resourceId: userId,
      metadata: { sizeBytes: bytes.byteLength },
    });

    return NextResponse.json({
      success: true,
      url: `/api/profile/signature/${userId}?kind=${kind}&v=${Date.now()}`,
    });
  } catch (error) {
    logger.error("Failed to upload signature", error, {
      route: "/api/profile/signature",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/profile/signature[?kind=stamp]
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const kind: "signature" | "stamp" =
      req.nextUrl.searchParams.get("kind") === "stamp" ? "stamp" : "signature";

    try {
      const existing = await fs.readdir(dirFor(kind));
      await Promise.all(
        existing
          .filter((f) => f.startsWith(`${session.user.id}.`))
          .map((f) => fs.unlink(path.join(dirFor(kind), f)).catch(() => null)),
      );
    } catch {
      /* ignore */
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { [fieldFor(kind)]: null },
    });

    await writeAudit({
      userId: session.user.id,
      action: kind === "stamp" ? "USER_STAMP_REMOVED" : "USER_SIGNATURE_REMOVED",
      resourceType: "user",
      resourceId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to remove signature", error, {
      route: "/api/profile/signature DELETE",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
