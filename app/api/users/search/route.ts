import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/users/search?q=...
 * Search active users by name, email, or department.
 * Available to any authenticated user (for memo recipient / recommender selection).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const query = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10)));
    const exclude = searchParams.get("exclude"); // comma-separated user IDs to exclude

    const excludeIds = exclude
      ? exclude.split(",").map((id) => id.trim()).filter(Boolean)
      : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      isActive: true,
    };

    if (excludeIds.length > 0) {
      where.id = { notIn: excludeIds };
    }

    if (query) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { department: { contains: query, mode: "insensitive" } },
        { jobTitle: { contains: query, mode: "insensitive" } },
      ];
    }

    const users = await db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        department: true,
        jobTitle: true,
      },
      take: limit,
      orderBy: { displayName: "asc" },
    });

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
