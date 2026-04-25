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
};

/**
 * GET /api/profile/signature/[userId]?kind=signature|stamp
 *
 * Auth-gated. Anyone signed in can fetch any user's signature/stamp
 * because they appear inside memo PDFs that are publicly viewable. We
 * still require auth here so external scrapers can't trivially harvest
 * signature images.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const { userId } = await params;
    const kind: "signature" | "stamp" =
      req.nextUrl.searchParams.get("kind") === "stamp" ? "stamp" : "signature";

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { signatureImage: true, officeStamp: true },
    });
    const relPath = kind === "stamp" ? user?.officeStamp : user?.signatureImage;
    if (!relPath) return new NextResponse("Not found", { status: 404 });

    // Path traversal guard
    const normalised = path.normalize(relPath);
    const expectedPrefix = path.join(
      "uploads",
      kind === "stamp" ? "stamps" : "signatures",
    );
    if (
      normalised.startsWith("..") ||
      path.isAbsolute(normalised) ||
      !normalised.startsWith(expectedPrefix)
    ) {
      return new NextResponse("Invalid path", { status: 403 });
    }

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(process.cwd(), normalised));
    } catch {
      return new NextResponse("Asset missing on disk", { status: 404 });
    }

    const ext = path.extname(normalised).slice(1).toLowerCase();
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Failed to serve signature", error, {
      route: "/api/profile/signature/[userId]",
    });
    return new NextResponse("Internal error", { status: 500 });
  }
}
