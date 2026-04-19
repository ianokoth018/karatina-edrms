"use client";

import { useState, useEffect, useCallback } from "react";

/* ---------- types ---------- */

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: "task" | "retention" | "correspondence";
  linkUrl: string;
  priority: string;
}

/* ---------- constants ---------- */

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  task: {
    dot: "bg-blue-500",
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-400",
    label: "Task",
  },
  retention: {
    dot: "bg-orange-500",
    bg: "bg-orange-100 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-400",
    label: "Retention",
  },
  correspondence: {
    dot: "bg-purple-500",
    bg: "bg-purple-100 dark:bg-purple-950/40",
    text: "text-purple-700 dark:text-purple-400",
    label: "Correspondence",
  },
};

/* ---------- helpers ---------- */

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/* ---------- icons ---------- */

function ChevronLeftIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

/* ---------- component ---------- */

export default function CalendarPage() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/calendar?month=${currentMonth + 1}&year=${currentYear}`
      );
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [currentMonth, currentYear]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  function goToPrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDate(null);
  }

  function goToNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDate(null);
  }

  function goToToday() {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDate(now);
  }

  // Group events by day number
  function getEventsForDay(day: number): CalendarEvent[] {
    return events.filter((e) => {
      const d = new Date(e.date);
      return d.getDate() === day && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  // Previous month trailing days
  const prevMonthDays = getDaysInMonth(
    currentMonth === 0 ? currentYear - 1 : currentYear,
    currentMonth === 0 ? 11 : currentMonth - 1
  );

  // Total cells needed (multiples of 7)
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  // Build day cells
  const cells: { day: number; inMonth: boolean; date: Date }[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (i < firstDay) {
      // Previous month
      const d = prevMonthDays - firstDay + i + 1;
      const m = currentMonth === 0 ? 11 : currentMonth - 1;
      const y = currentMonth === 0 ? currentYear - 1 : currentYear;
      cells.push({ day: d, inMonth: false, date: new Date(y, m, d) });
    } else if (i >= firstDay + daysInMonth) {
      // Next month
      const d = i - firstDay - daysInMonth + 1;
      const m = currentMonth === 11 ? 0 : currentMonth + 1;
      const y = currentMonth === 11 ? currentYear + 1 : currentYear;
      cells.push({ day: d, inMonth: false, date: new Date(y, m, d) });
    } else {
      const d = i - firstDay + 1;
      cells.push({ day: d, inMonth: true, date: new Date(currentYear, currentMonth, d) });
    }
  }

  // Events for selected date
  const selectedEvents = selectedDate
    ? events.filter((e) => isSameDay(new Date(e.date), selectedDate))
    : [];

  // All events grouped by day for list view
  const allEventsByDay: { date: Date; day: number; events: CalendarEvent[] }[] = [];
  if (isMobile) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayEvents = getEventsForDay(d);
      if (dayEvents.length > 0) {
        allEventsByDay.push({
          date: new Date(currentYear, currentMonth, d),
          day: d,
          events: dayEvents,
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Calendar & Reminders
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Tasks, retention deadlines, and correspondence due dates
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(TYPE_COLORS).map(([type, c]) => (
            <span
              key={type}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
            >
              <span className={`w-2 h-2 rounded-full ${c.dot}`} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar Card */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <CalendarIcon />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {formatMonthYear(currentYear, currentMonth)}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevMonth}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeftIcon />
            </button>
            <button
              onClick={goToToday}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#025f2f] transition-colors"
            >
              Today
            </button>
            <button
              onClick={goToNextMonth}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
              aria-label="Next month"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 dark:border-gray-700 border-t-[#02773b] rounded-full animate-spin" />
          </div>
        ) : isMobile ? (
          /* ---------- Mobile: List View ---------- */
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {allEventsByDay.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                No events this month
              </div>
            ) : (
              allEventsByDay.map(({ date, day, events: dayEvents }) => {
                const isToday = isSameDay(date, today);
                return (
                  <div key={day} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
                          isToday
                            ? "bg-[#02773b] text-white"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {day}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="ml-10 space-y-1.5">
                      {dayEvents.map((event) => {
                        const color = TYPE_COLORS[event.type];
                        return (
                          <a
                            key={event.id}
                            href={event.linkUrl}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${color.bg} ${color.text} hover:opacity-80 transition-opacity`}
                          >
                            <span className={`w-2 h-2 rounded-full ${color.dot} flex-shrink-0`} />
                            <span className="flex-1 truncate">{event.title}</span>
                            {event.priority === "overdue" || event.priority === "high" ? (
                              <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex-shrink-0">!</span>
                            ) : null}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* ---------- Desktop: Grid View ---------- */
          <div>
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800">
              {DAYS_OF_WEEK.map((d) => (
                <div
                  key={d}
                  className="px-2 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {cells.map((cell, idx) => {
                const isToday = cell.inMonth && isSameDay(cell.date, today);
                const isSelected =
                  selectedDate && isSameDay(cell.date, selectedDate);
                const dayEvents = cell.inMonth ? getEventsForDay(cell.day) : [];

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (cell.inMonth) setSelectedDate(cell.date);
                    }}
                    className={`relative min-h-[80px] sm:min-h-[100px] p-1.5 sm:p-2 border-b border-r border-gray-100 dark:border-gray-800 text-left transition-colors ${
                      cell.inMonth
                        ? "hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                        : "bg-gray-50/50 dark:bg-gray-900/50 cursor-default"
                    } ${isSelected ? "bg-[#02773b]/5 dark:bg-[#02773b]/10" : ""}`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${
                        isToday
                          ? "bg-[#02773b] text-white font-bold ring-2 ring-[#02773b]/30"
                          : cell.inMonth
                          ? "text-gray-900 dark:text-gray-100 font-medium"
                          : "text-gray-400 dark:text-gray-600"
                      } ${isSelected && !isToday ? "ring-2 ring-[#02773b]" : ""}`}
                    >
                      {cell.day}
                    </span>

                    {/* Event dots / pills */}
                    {dayEvents.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 3).map((event) => {
                          const color = TYPE_COLORS[event.type];
                          return (
                            <div
                              key={event.id}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-tight ${color.bg} ${color.text} truncate`}
                              title={event.title}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${color.dot} flex-shrink-0`} />
                              <span className="truncate hidden lg:inline">
                                {event.title.length > 20
                                  ? event.title.slice(0, 20) + "..."
                                  : event.title}
                              </span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 pl-1">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Selected Day Events (desktop only) */}
      {!isMobile && selectedDate && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Events for{" "}
              {selectedDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h3>
          </div>

          {selectedEvents.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
              No events on this day
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {selectedEvents.map((event) => {
                const color = TYPE_COLORS[event.type];
                return (
                  <div
                    key={event.id}
                    className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color.bg} ${color.text} flex-shrink-0`}
                    >
                      <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                      {color.label}
                    </span>
                    <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {event.title}
                    </span>
                    {(event.priority === "overdue" || event.priority === "high") && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex-shrink-0">
                        {event.priority === "overdue" ? "Overdue" : "High"}
                      </span>
                    )}
                    <a
                      href={event.linkUrl}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-[#02773b] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                      title="View details"
                    >
                      <LinkIcon />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
