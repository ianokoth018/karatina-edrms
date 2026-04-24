import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * GET /api/profile/photo/[userId] — serve the user's avatar.
 *
 * Auth required (any signed-in user can view another user's avatar — they
 * appear in lists, mentions, etc.). Returns 404 if no photo is set.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { userId } = await params;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { profilePhoto: true },
    });

    if (!user?.profilePhoto) {
      return new NextResponse("No photo", { status: 404 });
    }

    // Resolve under uploads/ defensively
    const normalized = path.normalize(user.profilePhoto);
    if (
      normalized.startsWith("..") ||
      path.isAbsolute(normalized) ||
      !normalized.startsWith(path.join("uploads", "avatars"))
    ) {
      return new NextResponse("Invalid path", { status: 403 });
    }

    const abs = path.join(process.cwd(), normalized);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(abs);
    } catch {
      return new NextResponse("Photo file missing", { status: 404 });
    }

    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=300", // 5 minutes
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Failed to serve profile photo", error, {
      route: "/api/profile/photo/[userId]",
    });
    return new NextResponse("Internal error", { status: 500 });
  }
}
