import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { invalidateCalendarCache } from "@/lib/business-calendar";

// Kenyan public holidays shipped as defaults when no calendar is configured
const KE_DEFAULT_HOLIDAYS = [
  { name: "New Year's Day",    date: "2025-01-01", recurring: true },
  { name: "Labour Day",        date: "2025-05-01", recurring: true },
  { name: "Madaraka Day",      date: "2025-06-01", recurring: true },
  { name: "Utamaduni Day",     date: "2025-10-10", recurring: true },
  { name: "Huduma Day",        date: "2025-10-27", recurring: true },
  { name: "Mashujaa Day",      date: "2025-10-20", recurring: true },
  { name: "Jamhuri Day",       date: "2025-12-12", recurring: true },
  { name: "Christmas Day",     date: "2025-12-25", recurring: true },
  { name: "Boxing Day",        date: "2025-12-26", recurring: true },
];

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

const VALID_TIMEZONES = Intl.supportedValuesOf("timeZone");

/**
 * GET /api/admin/work-calendar
 * Returns the default BusinessCalendar (or null if not yet configured).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const cal = await db.businessCalendar.findFirst({ where: { isDefault: true } });

    // Fetch the notification suppression setting
    const suppressSetting = await db.appSetting.findUnique({
      where: { key: "calendar.suppressNotificationsOutsideHours" },
    });
    const suppressNotificationsOutsideHours =
      suppressSetting ? (suppressSetting.value as boolean) : true;

    if (!cal) {
      // Return defaults with Kenyan public holidays pre-loaded
      return NextResponse.json({
        calendar: null,
        defaults: {
          name: "Default",
          timezone: "Africa/Nairobi",
          workdayStart: 8,
          workdayEnd: 17,
          workDays: [1, 2, 3, 4, 5],
          holidays: KE_DEFAULT_HOLIDAYS,
          suppressNotificationsOutsideHours: true,
        },
      });
    }

    return NextResponse.json({
      calendar: { ...cal, suppressNotificationsOutsideHours },
    });
  } catch (error) {
    logger.error("Failed to fetch work calendar", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface CalendarBody {
  name?: string;
  timezone?: string;
  workdayStart?: number;
  workdayEnd?: number;
  workDays?: number[];
  holidays?: { name: string; date: string; recurring: boolean }[];
  suppressNotificationsOutsideHours?: boolean;
}

/**
 * PUT /api/admin/work-calendar
 * Create or update the default BusinessCalendar.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as CalendarBody;

    const timezone = (body.timezone ?? "Africa/Nairobi").trim();
    if (!VALID_TIMEZONES.includes(timezone)) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }

    const workdayStart = Number(body.workdayStart ?? 8);
    const workdayEnd = Number(body.workdayEnd ?? 17);
    if (
      !Number.isInteger(workdayStart) || workdayStart < 0 || workdayStart > 23 ||
      !Number.isInteger(workdayEnd) || workdayEnd < 1 || workdayEnd > 24 ||
      workdayEnd <= workdayStart
    ) {
      return NextResponse.json({ error: "Invalid working hours" }, { status: 400 });
    }

    const workDays = body.workDays ?? [1, 2, 3, 4, 5];
    if (!Array.isArray(workDays) || workDays.some((d) => d < 0 || d > 6)) {
      return NextResponse.json({ error: "Invalid work days" }, { status: 400 });
    }

    // Holidays stored as JSON array of {name, date, recurring}
    const holidays = (body.holidays ?? []).filter(
      (h) => h.name && h.date && /^\d{4}-\d{2}-\d{2}$/.test(h.date)
    );

    const suppressNotificationsOutsideHours = body.suppressNotificationsOutsideHours ?? true;

    const existing = await db.businessCalendar.findFirst({ where: { isDefault: true } });

    const data = {
      name: (body.name ?? "Default").trim() || "Default",
      timezone,
      workdayStart,
      workdayEnd,
      workDays,
      holidays: holidays as object,
      isDefault: true,
      // Store notification preference as a JSON field via the existing
      // holidays Json column is not suitable — use AppSetting instead
    };

    let calId: string;
    if (existing) {
      const updated = await db.businessCalendar.update({ where: { id: existing.id }, data });
      calId = updated.id;
    } else {
      const created = await db.businessCalendar.create({ data });
      calId = created.id;
    }

    // Persist the notification suppression flag in AppSetting
    await db.appSetting.upsert({
      where: { key: "calendar.suppressNotificationsOutsideHours" },
      update: { value: suppressNotificationsOutsideHours as unknown as object },
      create: {
        key: "calendar.suppressNotificationsOutsideHours",
        value: suppressNotificationsOutsideHours as unknown as object,
        updatedById: session.user.id,
      },
    });

    // Bust the in-memory cache in the running process
    invalidateCalendarCache();

    await writeAudit({
      userId: session.user.id,
      action: "admin.work_calendar_updated",
      resourceType: "BusinessCalendar",
      resourceId: calId,
      metadata: { timezone, workdayStart, workdayEnd, workDays, holidayCount: holidays.length },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to save work calendar", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
