"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Kenyan Public Holidays (recurring annual) ───────────────────────────────
// Fixed-date holidays. Easter and other moveable feasts are not included here
// as they require year-by-year computation; add them via the admin calendar.
export const KE_PUBLIC_HOLIDAYS: { name: string; mmdd: string }[] = [
  { name: "New Year's Day",          mmdd: "01-01" },
  { name: "Good Friday",             mmdd: "03-29" },   // approximate — varies; update via admin
  { name: "Easter Monday",           mmdd: "04-01" },   // approximate
  { name: "Labour Day",              mmdd: "05-01" },
  { name: "Madaraka Day",            mmdd: "06-01" },
  { name: "Utamaduni Day",           mmdd: "10-10" },
  { name: "Huduma Day",              mmdd: "10-27" },
  { name: "Mashujaa Day",            mmdd: "10-20" },
  { name: "Jamhuri Day",             mmdd: "12-12" },
  { name: "Christmas Day",           mmdd: "12-25" },
  { name: "Boxing Day",              mmdd: "12-26" },
  { name: "Eid ul-Fitr",             mmdd: "04-10" },   // approximate
  { name: "Eid ul-Adha",             mmdd: "06-17" },   // approximate
];

// Build Set<YYYY-MM-DD> for a given year
function keHolidayDatesForYear(year: number): Set<string> {
  const s = new Set<string>();
  for (const h of KE_PUBLIC_HOLIDAYS) {
    s.add(`${year}-${h.mmdd}`);
  }
  return s;
}

// ─── Calendar config fetched from admin ──────────────────────────────────────

interface RemoteCalendar {
  workDays: number[];       // 0=Sun…6=Sat
  holidays: { name: string; date: string; recurring: boolean }[];
  workdayStart: number;
  workdayEnd: number;
  timezone: string;
}

let _cachedCalendar: RemoteCalendar | null = null;
let _cacheTs = 0;

async function fetchCalendar(): Promise<RemoteCalendar | null> {
  if (_cachedCalendar && Date.now() - _cacheTs < 5 * 60 * 1000) return _cachedCalendar;
  try {
    // /api/work-calendar is accessible to all authenticated users
    const res = await fetch("/api/work-calendar");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.calendar) return null;
    const raw = data.calendar;
    const holidays = Array.isArray(raw.holidays)
      ? raw.holidays.map((h: unknown) =>
          typeof h === "string"
            ? { name: h, date: h, recurring: false }
            : (h as { name: string; date: string; recurring: boolean })
        )
      : [];
    _cachedCalendar = {
      workDays: raw.workDays ?? [1, 2, 3, 4, 5],
      holidays,
      workdayStart: raw.workdayStart ?? 8,
      workdayEnd: raw.workdayEnd ?? 17,
      timezone: raw.timezone ?? "Africa/Nairobi",
    };
    _cacheTs = Date.now();
    return _cachedCalendar;
  } catch {
    return null;
  }
}

// ─── Business-day logic (client-side, mirrors lib/business-calendar.ts) ──────

function buildHolidaySet(cal: RemoteCalendar | null, year: number): Set<string> {
  // Start with Kenyan public holidays
  const s = keHolidayDatesForYear(year);
  if (!cal) return s;
  for (const h of cal.holidays) {
    if (!h.date) continue;
    if (h.recurring) {
      // recurring: use MM-DD portion for any year
      const mmdd = h.date.slice(5); // "MM-DD"
      s.add(`${year}-${mmdd}`);
    } else {
      s.add(h.date.slice(0, 10));
    }
  }
  return s;
}

function isBusinessDay(date: Date, cal: RemoteCalendar | null, holidaySet: Set<string>): boolean {
  const workDays = cal?.workDays ?? [1, 2, 3, 4, 5];
  if (!workDays.includes(date.getDay())) return false;
  const iso = toIso(date);
  if (holidaySet.has(iso)) return false;
  return true;
}

function countBusinessDays(from: Date, to: Date, cal: RemoteCalendar | null): number {
  if (!from || !to || to < from) return 0;
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  // Pre-build holiday sets for the years involved
  const years = new Set<number>();
  for (let y = cursor.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
  const allHolidays = new Set<string>();
  for (const y of years) {
    for (const d of buildHolidaySet(cal, y)) allHolidays.add(d);
  }

  while (cursor <= end) {
    if (isBusinessDay(cursor, cal, allHolidays)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function getHolidayName(date: Date, cal: RemoteCalendar | null): string | null {
  const iso = toIso(date);
  const mmdd = iso.slice(5);
  // Check Kenyan holidays
  const ke = KE_PUBLIC_HOLIDAYS.find((h) => h.mmdd === mmdd);
  if (ke) return ke.name;
  // Check admin-configured holidays
  if (cal) {
    for (const h of cal.holidays) {
      if (h.recurring && h.date.slice(5) === mmdd) return h.name;
      if (!h.recurring && h.date.slice(0, 10) === iso) return h.name;
    }
  }
  return null;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function inRange(d: Date, from: Date | null, to: Date | null): boolean {
  if (!from || !to) return false;
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

// ─── Mini calendar rendering ──────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

interface MiniCalendarProps {
  year: number;
  month: number;
  selected: { from: Date | null; to: Date | null };
  hovered: Date | null;
  cal: RemoteCalendar | null;
  onDayClick: (d: Date) => void;
  onDayHover: (d: Date | null) => void;
}

function MiniCalendar({ year, month, selected, hovered, cal, onDayClick, onDayHover }: MiniCalendarProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const workDays = cal?.workDays ?? [1, 2, 3, 4, 5];

  const holidaySet = buildHolidaySet(cal, year);

  const rangeEnd = selected.to ?? hovered ?? null;

  const cells: (Date | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  return (
    <div className="select-none">
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, idx) => {
          if (!d) return <div key={`empty-${idx}`} />;

          const iso = toIso(d);
          const isWeekend = !workDays.includes(d.getDay());
          const isHoliday = holidaySet.has(iso);
          const holidayName = isHoliday ? getHolidayName(d, cal) : null;
          const isStart = selected.from ? sameDay(d, selected.from) : false;
          const isEnd = selected.to ? sameDay(d, selected.to) : false;
          const isInRange = inRange(d, selected.from, rangeEnd);
          const isToday = sameDay(d, new Date());
          const isDisabled = false;
          const isBizDay = !isWeekend && !isHoliday;

          let cellClass =
            "relative flex items-center justify-center h-8 text-xs cursor-pointer transition-colors rounded-lg mx-0.5 ";

          if (isStart || isEnd) {
            cellClass += "bg-[#02773b] text-white font-semibold z-10 ";
          } else if (isInRange && isBizDay) {
            cellClass += "bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-[#4ade80] ";
          } else if (isInRange && (isWeekend || isHoliday)) {
            cellClass += "bg-gray-100 dark:bg-gray-800 text-gray-400 line-through ";
          } else if (isHoliday) {
            cellClass += "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 ";
          } else if (isWeekend) {
            cellClass += "text-gray-400 dark:text-gray-500 ";
          } else if (isToday) {
            cellClass += "text-[#02773b] dark:text-[#4ade80] font-semibold ring-1 ring-[#02773b]/40 ";
          } else {
            cellClass += "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 ";
          }

          return (
            <div
              key={iso}
              className={cellClass}
              title={holidayName ? `${holidayName} (Holiday)` : isWeekend ? "Weekend" : undefined}
              onClick={() => !isDisabled && onDayClick(d)}
              onMouseEnter={() => onDayHover(d)}
              onMouseLeave={() => onDayHover(null)}
            >
              {d.getDate()}
              {isHoliday && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-red-400" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

interface BusinessDayRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange, businessDays: number) => void;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** If true, shows an inline (always-open) calendar rather than a dropdown. */
  inline?: boolean;
}

export function BusinessDayRangePicker({
  value,
  onChange,
  label,
  fromLabel = "Start Date",
  toLabel = "End Date",
  disabled = false,
  className = "",
  inline = false,
}: BusinessDayRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [cal, setCal] = useState<RemoteCalendar | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  const [selecting, setSelecting] = useState<"from" | "to">("from");

  // Two-month view
  const [viewYear, setViewYear] = useState(() => (value.from ?? new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value.from ?? new Date()).getMonth());

  const rightMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const rightYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  useEffect(() => {
    fetchCalendar().then(setCal);
  }, []);

  const bizDays = countBusinessDays(
    value.from ?? new Date(0),
    value.to ?? new Date(0),
    cal
  );

  function handleDayClick(d: Date) {
    if (selecting === "from" || (value.from && d < value.from)) {
      onChange({ from: d, to: null }, 0);
      setSelecting("to");
    } else {
      const range = { from: value.from, to: d };
      const bd = countBusinessDays(value.from!, d, cal);
      onChange(range, bd);
      setSelecting("from");
      if (!inline) setOpen(false);
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const formatDate = useCallback((d: Date | null) => {
    if (!d) return "";
    return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
  }, []);

  const calendar = (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl p-4 w-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex gap-8">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {MONTH_NAMES[rightMonth]} {rightYear}
          </span>
        </div>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Dual calendar grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <MiniCalendar
          year={viewYear} month={viewMonth}
          selected={value} hovered={hovered} cal={cal}
          onDayClick={handleDayClick} onDayHover={setHovered}
        />
        <MiniCalendar
          year={rightYear} month={rightMonth}
          selected={value} hovered={hovered} cal={cal}
          onDayClick={handleDayClick} onDayHover={setHovered}
        />
      </div>

      {/* Legend & summary */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#02773b]" />Working day
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gray-200 dark:bg-gray-700" />Weekend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-950/30" />
            <span className="text-red-500">Holiday</span>
          </span>
        </div>

        {value.from && value.to && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Business days:</span>
            <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-[#02773b] text-white text-xs font-bold">
              {bizDays}
            </span>
          </div>
        )}
      </div>

      {/* Instruction hint */}
      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        {selecting === "from"
          ? "Click a start date"
          : "Click an end date (or click before start to reset)"}
      </p>
    </div>
  );

  if (inline) {
    return (
      <div className={className}>
        {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</label>}
        {calendar}
        {value.from && value.to && (
          <BusinessDaySummary from={value.from} to={value.to} bizDays={bizDays} />
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{label}</label>}

      {/* Trigger inputs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (!disabled) { setSelecting("from"); setOpen(true); } }}
          disabled={disabled}
          className="flex-1 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-left outline-none focus:border-[#02773b] hover:border-[#02773b]/40 transition-colors disabled:opacity-50"
        >
          {value.from ? (
            <span className="text-gray-900 dark:text-gray-100">{formatDate(value.from)}</span>
          ) : (
            <span className="text-gray-400">{fromLabel}</span>
          )}
        </button>

        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>

        <button
          onClick={() => { if (!disabled) { setSelecting("to"); setOpen(true); } }}
          disabled={disabled}
          className="flex-1 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-left outline-none focus:border-[#02773b] hover:border-[#02773b]/40 transition-colors disabled:opacity-50"
        >
          {value.to ? (
            <span className="text-gray-900 dark:text-gray-100">{formatDate(value.to)}</span>
          ) : (
            <span className="text-gray-400">{toLabel}</span>
          )}
        </button>

        {(value.from || value.to) && (
          <button
            onClick={() => onChange({ from: null, to: null }, 0)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Clear"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Business days badge */}
      {value.from && value.to && (
        <BusinessDaySummary from={value.from} to={value.to} bizDays={bizDays} />
      )}

      {/* Dropdown */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 z-50 mt-2 w-full sm:w-[560px]">
            {calendar}
          </div>
        </>
      )}
    </div>
  );
}

function BusinessDaySummary({ from, to, bizDays }: { from: Date; to: Date; bizDays: number }) {
  const totalDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const nonBizDays = totalDays - bizDays;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-[#02773b]/10 text-[#02773b] dark:bg-[#02773b]/20 dark:text-[#4ade80] font-semibold">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        {bizDays} business {bizDays === 1 ? "day" : "days"}
      </span>
      <span className="text-gray-400 dark:text-gray-500">
        ({totalDays} total, {nonBizDays} excluded)
      </span>
    </div>
  );
}

// ─── Convenience hook ─────────────────────────────────────────────────────────

export function useBusinessDays(from: Date | null, to: Date | null): {
  businessDays: number;
  loading: boolean;
} {
  const [cal, setCal] = useState<RemoteCalendar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCalendar().then((c) => { setCal(c); setLoading(false); });
  }, []);

  const businessDays = from && to ? countBusinessDays(from, to, cal) : 0;
  return { businessDays, loading };
}
