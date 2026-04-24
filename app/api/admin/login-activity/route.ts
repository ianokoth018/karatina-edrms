import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/admin/login-activity — admin-only login attempt log.
 *
 * Query params:
 *   q          string — match against email
 *   success    "true" | "false"
 *   reason     specific reason filter
 *   sinceDays  number — default 7
 *   page       number
 *   limit      number — max 100
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const success = sp.get("success");
    const reason = sp.get("reason");
    const sinceDays = Math.max(1, Math.min(90, Number(sp.get("sinceDays") ?? "7")));
    const page = Math.max(1, Number(sp.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(10, Number(sp.get("limit") ?? "50")));

    const where: Prisma.LoginAttemptWhereInput = {
      createdAt: { gte: new Date(Date.now() - sinceDays * 86400_000) },
    };
    if (q) where.email = { contains: q, mode: "insensitive" };
    if (success === "true") where.success = true;
    if (success === "false") where.success = false;
    if (reason) where.reason = reason;

    const [rows, total, summary] = await Promise.all([
      db.loginAttempt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.loginAttempt.count({ where }),
      db.loginAttempt.groupBy({
        by: ["reason", "success"],
        where: { createdAt: { gte: new Date(Date.now() - sinceDays * 86400_000) } },
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      attempts: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary,
      sinceDays,
    });
  } catch (error) {
    logger.error("Failed to read login activity", error, {
      route: "/api/admin/login-activity",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
