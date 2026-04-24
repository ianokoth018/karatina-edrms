// ---------------------------------------------------------------------------
// Business Calendar — working-hours-aware SLA calculation
// ---------------------------------------------------------------------------
// Business hours exclude nights, non-working days (weekends), and public
// holidays defined in a BusinessCalendar record.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";

export interface CalendarConfig {
  timezone: string;
  workdayStart: number;   // e.g. 8 = 08:00
  workdayEnd: number;     // e.g. 17 = 17:00
  workDays: number[];     // 0=Sun, 1=Mon, ..., 6=Sat
  holidays: string[];     // "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Fetch the default calendar (or fall back to a 24/7 calendar)
// ---------------------------------------------------------------------------

let _defaultCalendarCache: CalendarConfig | null = null;
let _cacheExpiry = 0;

export async function getDefaultCalendar(): Promise<CalendarConfig> {
  if (_defaultCalendarCache && Date.now() < _cacheExpiry) {
    return _defaultCalendarCache;
  }

  const cal = await db.businessCalendar.findFirst({ where: { isDefault: true } });

  const config: CalendarConfig = cal
    ? {
        timezone: cal.timezone,
        workdayStart: cal.workdayStart,
        workdayEnd: cal.workdayEnd,
        workDays: cal.workDays as number[],
        holidays: (cal.holidays as string[]) ?? [],
      }
    : {
        // Fallback: Mon–Fri, 08:00–17:00, Africa/Nairobi, no holidays
        timezone: "Africa/Nairobi",
        workdayStart: 8,
        workdayEnd: 17,
        workDays: [1, 2, 3, 4, 5],
        holidays: [],
      };

  _defaultCalendarCache = config;
  _cacheExpiry = Date.now() + 5 * 60 * 1000; // cache for 5 minutes
  return config;
}

// ---------------------------------------------------------------------------
// Core: count working hours between two dates
// ---------------------------------------------------------------------------

function toLocalDate(date: Date, timezone: string): Date {
  // Use Intl to get the wall-clock time in the target timezone.
  // We build a fake Date in UTC that has the same digits.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isWorkDay(d: Date, cal: CalendarConfig): boolean {
  if (!cal.workDays.includes(d.getDay())) return false;
  if (cal.holidays.includes(isoDate(d))) return false;
  return true;
}

/**
 * Count working hours between `from` and `to` according to the calendar.
 */
export function workingHoursBetween(from: Date, to: Date, cal: CalendarConfig): number {
  if (to <= from) return 0;

  let total = 0;
  const cursor = new Date(from);

  // Advance to start of first working segment
  while (cursor < to) {
    const local = toLocalDate(cursor, cal.timezone);

    if (!isWorkDay(local, cal)) {
      // Skip to midnight of next day (in local time, approximated in UTC)
      cursor.setUTCHours(cursor.getUTCHours() + (24 - local.getHours()));
      continue;
    }

    // Within a working day: clamp to [workdayStart, workdayEnd]
    const dayStart = new Date(cursor);
    const dayEnd = new Date(cursor);

    const localDayStart = new Date(local);
    localDayStart.setHours(cal.workdayStart, 0, 0, 0);
    const localDayEnd = new Date(local);
    localDayEnd.setHours(cal.workdayEnd, 0, 0, 0);

    // Convert back to UTC (approximate — Intl offset not trivially reversible)
    const utcOffset = cursor.getTime() - local.getTime();
    dayStart.setTime(localDayStart.getTime() + utcOffset);
    dayEnd.setTime(localDayEnd.getTime() + utcOffset);

    if (cursor < dayStart) {
      cursor.setTime(dayStart.getTime());
      continue;
    }

    if (cursor >= dayEnd) {
      // Past end of working day; jump to tomorrow
      cursor.setTime(dayEnd.getTime() + 1);
      continue;
    }

    const segmentEnd = new Date(Math.min(to.getTime(), dayEnd.getTime()));
    total += (segmentEnd.getTime() - cursor.getTime()) / (1000 * 60 * 60);
    cursor.setTime(dayEnd.getTime() + 1);
  }

  return total;
}

/**
 * Add `workingHours` business hours to `from`, returning the resulting wall-clock time.
 */
export function addWorkingHours(from: Date, workingHours: number, cal: CalendarConfig): Date {
  let remaining = workingHours;
  const cursor = new Date(from);

  while (remaining > 0) {
    const local = toLocalDate(cursor, cal.timezone);

    if (!isWorkDay(local, cal)) {
      cursor.setTime(cursor.getTime() + 60 * 60 * 1000); // advance 1 hour and re-check
      continue;
    }

    const localDayEnd = new Date(local);
    localDayEnd.setHours(cal.workdayEnd, 0, 0, 0);
    const utcOffset = cursor.getTime() - local.getTime();
    const dayEnd = new Date(localDayEnd.getTime() + utcOffset);

    if (cursor >= dayEnd) {
      cursor.setTime(dayEnd.getTime() + 1);
      continue;
    }

    const localDayStart = new Date(local);
    localDayStart.setHours(cal.workdayStart, 0, 0, 0);
    const dayStart = new Date(localDayStart.getTime() + utcOffset);

    if (cursor < dayStart) {
      cursor.setTime(dayStart.getTime());
      continue;
    }

    const hoursLeftToday = (dayEnd.getTime() - cursor.getTime()) / (1000 * 60 * 60);

    if (remaining <= hoursLeftToday) {
      cursor.setTime(cursor.getTime() + remaining * 60 * 60 * 1000);
      remaining = 0;
    } else {
      remaining -= hoursLeftToday;
      cursor.setTime(dayEnd.getTime() + 1);
    }
  }

  return cursor;
}

/**
 * Calculate SLA due date from `start` + `slaWorkingHours` business hours.
 * Falls back to calendar-unaware calculation if no calendar is configured.
 */
export async function calculateSlaDeadline(
  start: Date,
  slaWorkingHours: number,
  calendarConfig?: CalendarConfig
): Promise<Date> {
  const cal = calendarConfig ?? (await getDefaultCalendar());
  return addWorkingHours(start, slaWorkingHours, cal);
}

/**
 * Calculate how many working hours remain until `deadline`.
 */
export async function workingHoursRemaining(
  deadline: Date,
  calendarConfig?: CalendarConfig
): Promise<number> {
  const cal = calendarConfig ?? (await getDefaultCalendar());
  return workingHoursBetween(new Date(), deadline, cal);
}
