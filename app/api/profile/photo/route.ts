import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 4 * 1024 * 1024; // 4 MiB
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");

function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

/**
 * POST /api/profile/photo — upload (or replace) the current user's avatar.
 *
 * Multipart body: { file: File }
 *
 * Stores under uploads/avatars/{userId}.{ext}; previous photos for the
 * same user are overwritten. Returns the public URL the client can use
 * for display (cache-busted with the new mtime).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Provide an image file under the 'file' field." },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, WebP, or GIF images are allowed." },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Maximum file size is ${MAX_BYTES / (1024 * 1024)} MiB.` },
        { status: 413 }
      );
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const ext = extensionFor(file.type);
    const filename = `${session.user.id}.${ext}`;
    const targetAbs = path.join(UPLOAD_DIR, filename);

    // Remove any prior file with a different extension before writing.
    try {
      const entries = await fs.readdir(UPLOAD_DIR);
      await Promise.all(
        entries
          .filter((e) => e.startsWith(`${session.user.id}.`))
          .map((e) => fs.unlink(path.join(UPLOAD_DIR, e)).catch(() => null))
      );
    } catch {
      // directory empty / unreadable — ignore
    }

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(targetAbs, Buffer.from(arrayBuffer));

    // Use the relative path (under uploads/) so the existing file-serving
    // patterns can read it back. We append a cache-buster to the URL for
    // the client.
    const relPath = path.posix.join("uploads", "avatars", filename);
    const cacheBuster = crypto
      .createHash("sha256")
      .update(Buffer.from(arrayBuffer))
      .digest("hex")
      .slice(0, 8);

    await db.user.update({
      where: { id: session.user.id },
      data: { profilePhoto: relPath },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_PROFILE_PHOTO_UPDATED",
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { mime: file.type, sizeBytes: file.size },
    });

    return NextResponse.json({
      success: true,
      url: `/api/profile/photo/${session.user.id}?v=${cacheBuster}`,
    });
  } catch (error) {
    logger.error("Failed to upload profile photo", error, {
      route: "/api/profile/photo",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/profile/photo — remove the current user's avatar.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const entries = await fs.readdir(UPLOAD_DIR);
      await Promise.all(
        entries
          .filter((e) => e.startsWith(`${session.user.id}.`))
          .map((e) => fs.unlink(path.join(UPLOAD_DIR, e)).catch(() => null))
      );
    } catch {
      /* nothing to delete */
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { profilePhoto: null },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_PROFILE_PHOTO_REMOVED",
      resourceType: "user",
      resourceId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete profile photo", error, {
      route: "/api/profile/photo",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
