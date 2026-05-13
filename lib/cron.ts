// ---------------------------------------------------------------------------
// Tiny cron subset — enough to drive scheduled workflow triggers without
// pulling in a dependency. Supports the classic 5-field expression:
//
//   minute hour dayOfMonth month dayOfWeek
//
// Per-field syntax:
//   *           — any value
//   */N         — every N (e.g. */15 in minute = :00, :15, :30, :45)
//   1,3,5       — comma-separated literal list
//   1           — single literal
//
// Notably NOT supported (intentional):
//   - macros (@daily, @hourly, …)
//   - ranges (1-5)
//   - step on a range (1-10/2)
//   - L / W / # day-of-month modifiers
// ---------------------------------------------------------------------------

export interface CronParsed {
  minute: number[];      // 0–59
  hour: number[];        // 0–23
  dayOfMonth: number[];  // 1–31
  month: number[];       // 1–12
  dayOfWeek: number[];   // 0–6 (Sunday=0)
}

interface FieldSpec {
  min: number;
  max: number;
}

const FIELDS: Record<keyof CronParsed, FieldSpec> = {
  minute:     { min: 0,  max: 59 },
  hour:       { min: 0,  max: 23 },
  dayOfMonth: { min: 1,  max: 31 },
  month:      { min: 1,  max: 12 },
  dayOfWeek:  { min: 0,  max: 6  },
};

function parseField(raw: string, spec: FieldSpec): number[] | null {
  if (raw === "*") {
    const out: number[] = [];
    for (let v = spec.min; v <= spec.max; v++) out.push(v);
    return out;
  }
  // */N
  const stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isFinite(step) || step <= 0) return null;
    const out: number[] = [];
    for (let v = spec.min; v <= spec.max; v += step) out.push(v);
    return out;
  }
  // comma-separated literal list (or single literal)
  const parts = raw.split(",");
  const set = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) return null;
    set.add(n);
  }
  if (set.size === 0) return null;
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Parse a 5-field cron expression. Returns null on invalid input.
 */
export function parseCron(expr: string): CronParsed | null {
  if (typeof expr !== "string") return null;
  const tokens = expr.trim().split(/\s+/);
  if (tokens.length !== 5) return null;
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = tokens;
  const minute     = parseField(minRaw,  FIELDS.minute);
  const hour       = parseField(hourRaw, FIELDS.hour);
  const dayOfMonth = parseField(domRaw,  FIELDS.dayOfMonth);
  const month      = parseField(monRaw,  FIELDS.month);
  const dayOfWeek  = parseField(dowRaw,  FIELDS.dayOfWeek);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/**
 * Break a Date into its calendar parts in the given IANA timezone.
 * Uses Intl.DateTimeFormat to avoid any new dependencies.
 */
function partsInTz(date: Date, timeZone: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year:    "numeric",
    month:   "2-digit",
    day:     "2-digit",
    hour:    "2-digit",
    minute:  "2-digit",
    second:  "2-digit",
    weekday: "short",
    hour12:  false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl returns hour "24" at midnight on some engines — normalise to 0.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year:   Number(get("year")),
    month:  Number(get("month")),
    day:    Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

/**
 * Find the next firing time strictly after `after`.
 *
 * Implementation: minute-by-minute scan in the trigger's timezone, with a
 * one-year safety cap. This is plenty fast for cron expressions that fire
 * at least once per year (which is required for a sane trigger anyway) —
 * worst case ~525,600 iterations on a stale trigger, normally <60.
 *
 * Caller is responsible for passing a sane cron + tz; nextFireTime always
 * returns a Date (returns `after + 1 year` if no match found — caller can
 * choose to ignore such "never fires" triggers).
 */
export function nextFireTime(
  parsed: CronParsed,
  after: Date,
  tz: string = "Africa/Nairobi"
): Date {
  // Start at the next whole minute strictly after `after`.
  const start = new Date(after.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const minuteMs = 60 * 1000;
  const maxIters = 366 * 24 * 60; // one-year cap

  const monthSet     = new Set(parsed.month);
  const minuteSet    = new Set(parsed.minute);
  const hourSet      = new Set(parsed.hour);
  const dayOfMonthSet = new Set(parsed.dayOfMonth);
  const dayOfWeekSet  = new Set(parsed.dayOfWeek);

  // Vixie cron semantics: if BOTH dayOfMonth and dayOfWeek are restricted
  // (i.e. not "*"), match when EITHER matches. If one is "*" (== full range)
  // it's effectively unrestricted.
  const domRestricted = parsed.dayOfMonth.length !== 31;
  const dowRestricted = parsed.dayOfWeek.length !== 7;

  let cursor = start.getTime();
  for (let i = 0; i < maxIters; i++) {
    const d = new Date(cursor);
    const p = partsInTz(d, tz);

    if (
      minuteSet.has(p.minute) &&
      hourSet.has(p.hour) &&
      monthSet.has(p.month)
    ) {
      const domOk = dayOfMonthSet.has(p.day);
      const dowOk = dayOfWeekSet.has(p.weekday);
      let dayOk: boolean;
      if (domRestricted && dowRestricted) dayOk = domOk || dowOk;
      else if (domRestricted)             dayOk = domOk;
      else if (dowRestricted)             dayOk = dowOk;
      else                                dayOk = true;
      if (dayOk) return d;
    }
    cursor += minuteMs;
  }
  // No match within the safety cap — return cursor anyway so callers always
  // have a value. A caller that sees nextFireAt drift a year out can treat
  // the cron as effectively dead.
  return new Date(cursor);
}
