import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET  /api/workflows/calendars — list all business calendars
 * POST /api/workflows/calendars — create a calendar
 */

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const calendars = await db.businessCalendar.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ calendars });
  } catch (error) {
    logger.error("Failed to list business calendars", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hasPermission =
      session.user.permissions.includes("workflows:manage") ||
      session.user.roles.includes("Admin");
    if (!hasPermission) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { name, timezone, workdayStart, workdayEnd, workDays, holidays, isDefault } = body as {
      name: string;
      timezone?: string;
      workdayStart?: number;
      workdayEnd?: number;
      workDays?: number[];
      holidays?: string[];
      isDefault?: boolean;
    };

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    // Only one default calendar allowed
    if (isDefault) {
      await db.businessCalendar.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const calendar = await db.businessCalendar.create({
      data: {
        name,
        timezone: timezone ?? "Africa/Nairobi",
        workdayStart: workdayStart ?? 8,
        workdayEnd: workdayEnd ?? 17,
        workDays: workDays ?? [1, 2, 3, 4, 5],
        holidays: (holidays ?? []) as object,
        isDefault: isDefault ?? false,
      },
    });

    return NextResponse.json({ calendar }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create business calendar", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
