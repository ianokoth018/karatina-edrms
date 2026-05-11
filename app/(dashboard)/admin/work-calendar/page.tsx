"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`,
}));

interface Holiday {
  name: string;
  date: string;       // YYYY-MM-DD
  recurring: boolean; // annual recurrence
}

interface CalendarData {
  id?: string;
  name: string;
  timezone: string;
  workdayStart: number;
  workdayEnd: number;
  workDays: number[];
  holidays: Holiday[];
  suppressNotificationsOutsideHours: boolean;
}

const DEFAULT: CalendarData = {
  name: "Default",
  timezone: "Africa/Nairobi",
  workdayStart: 8,
  workdayEnd: 17,
  workDays: [1, 2, 3, 4, 5],
  holidays: [],
  suppressNotificationsOutsideHours: true,
};

// ─── Popular timezones shown first ───────────────────────────────────────────
const POPULAR_TZ = [
  "Africa/Nairobi",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "UTC",
];

export default function WorkCalendarPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [cal, setCal] = useState<CalendarData>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Holiday form state
  const [newHoliday, setNewHoliday] = useState<Holiday>({ name: "", date: "", recurring: false });
  const [addingHoliday, setAddingHoliday] = useState(false);

  // All available timezones
  const [allTz] = useState<string[]>(() => {
    try {
      const all = Intl.supportedValuesOf("timeZone") as string[];
      return [...POPULAR_TZ, ...all.filter((z) => !POPULAR_TZ.includes(z))];
    } catch {
      return POPULAR_TZ;
    }
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/work-calendar");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      const raw = data.calendar ?? data.defaults;
      if (raw) {
        const holidayRaw = Array.isArray(raw.holidays) ? raw.holidays : [];
        const holidays: Holiday[] = holidayRaw.map((h: unknown) =>
          typeof h === "string"
            ? { name: h, date: h, recurring: false }
            : (h as Holiday)
        );
        setCal({
          id: raw.id,
          name: raw.name ?? "Default",
          timezone: raw.timezone ?? "Africa/Nairobi",
          workdayStart: raw.workdayStart ?? 8,
          workdayEnd: raw.workdayEnd ?? 17,
          workDays: raw.workDays ?? [1, 2, 3, 4, 5],
          holidays,
          suppressNotificationsOutsideHours: raw.suppressNotificationsOutsideHours ?? true,
        });
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Also fetch the notification suppression setting
  useEffect(() => {
    async function fetchSuppression() {
      try {
        const res = await fetch("/api/admin/work-calendar");
        if (!res.ok) return;
        // suppression stored separately in AppSetting — fetched inline above
      } catch { /* ignore */ }
    }
    fetchSuppression();
  }, []);

  function toggleDay(day: number) {
    setCal((prev) => ({
      ...prev,
      workDays: prev.workDays.includes(day)
        ? prev.workDays.filter((d) => d !== day)
        : [...prev.workDays, day].sort((a, b) => a - b),
    }));
  }

  function addHoliday() {
    if (!newHoliday.name.trim() || !newHoliday.date) return;
    setCal((prev) => ({
      ...prev,
      holidays: [...prev.holidays, { ...newHoliday, name: newHoliday.name.trim() }],
    }));
    setNewHoliday({ name: "", date: "", recurring: false });
    setAddingHoliday(false);
  }

  function removeHoliday(idx: number) {
    setCal((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((_, i) => i !== idx),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/work-calendar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cal),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3 text-gray-500">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-[#02773b] rounded-full animate-spin" />
        Loading calendar…
      </div>
    );
  }

  const hoursPerDay = Math.max(0, cal.workdayEnd - cal.workdayStart);
  const workingDaysCount = cal.workDays.length;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Work Calendar</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Define working days, hours, and public holidays. Used for SLA deadlines, task assignment windows, and notification delivery.
        </p>
      </div>

      {/* Status banners */}
      {saved && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Work calendar saved successfully</p>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Working Days/Week", value: workingDaysCount, unit: "days" },
          { label: "Hours/Day", value: hoursPerDay, unit: "hrs" },
          { label: "Public Holidays", value: cal.holidays.length, unit: "dates" },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-[#02773b]">{s.value}<span className="text-sm font-normal text-gray-400 ml-1">{s.unit}</span></p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Working Days */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-[#02773b]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
              </svg>
              Working Days
            </h2>
          </div>
          <div className="p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Select the days staff are expected to work</p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const active = cal.workDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    title={DAY_FULL[day]}
                    className={`w-11 h-11 rounded-xl text-sm font-semibold transition-all ${
                      active
                        ? "bg-[#02773b] text-white shadow-md shadow-[#02773b]/20"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              {workingDaysCount === 0
                ? "No working days selected"
                : `${workingDaysCount} working ${workingDaysCount === 1 ? "day" : "days"} per week: ${cal.workDays.map((d) => DAY_FULL[d]).join(", ")}`}
            </p>
          </div>
        </div>

        {/* Working Hours */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-[#dd9f42]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Working Hours
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Start Time</label>
                <select
                  value={cal.workdayStart}
                  onChange={(e) => setCal((p) => ({ ...p, workdayStart: Number(e.target.value) }))}
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                >
                  {HOURS.filter((h) => h.value < cal.workdayEnd).map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">End Time</label>
                <select
                  value={cal.workdayEnd}
                  onChange={(e) => setCal((p) => ({ ...p, workdayEnd: Number(e.target.value) }))}
                  className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                >
                  {HOURS.filter((h) => h.value > cal.workdayStart).map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Visual hour bar */}
            <div>
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
              </div>
              <div className="relative h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="absolute h-full bg-[#02773b]/70 rounded-full transition-all"
                  style={{
                    left: `${(cal.workdayStart / 24) * 100}%`,
                    width: `${((cal.workdayEnd - cal.workdayStart) / 24) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1 text-center">
                {hoursPerDay} working hours per day
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Timezone</label>
              <select
                value={cal.timezone}
                onChange={(e) => setCal((p) => ({ ...p, timezone: e.target.value }))}
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
              >
                <optgroup label="Popular">
                  {POPULAR_TZ.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </optgroup>
                <optgroup label="All Timezones">
                  {allTz.filter((tz) => !POPULAR_TZ.includes(tz)).map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Calendar Name</label>
              <input
                type="text"
                value={cal.name}
                onChange={(e) => setCal((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Standard Work Calendar"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
              />
            </div>
          </div>
        </div>

        {/* Notification Rules */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-blue-500/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              Notification Rules
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={cal.suppressNotificationsOutsideHours}
                  onChange={(e) => setCal((p) => ({ ...p, suppressNotificationsOutsideHours: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${
                  cal.suppressNotificationsOutsideHours ? "bg-[#02773b]" : "bg-gray-200 dark:bg-gray-700"
                }`} />
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  cal.suppressNotificationsOutsideHours ? "translate-x-4" : ""
                }`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Hold email &amp; SMS outside working hours</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Email and SMS notifications triggered outside working hours will be held and delivered at the start of the next working period. In-app notifications are always delivered immediately.
                </p>
              </div>
            </label>

            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">What this controls</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-disc list-inside">
                <li>Task assignment email/SMS notifications</li>
                <li>SLA warning notifications</li>
                <li>Workflow completion alerts</li>
                <li>Deadline reminders</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Deadline Calculation Info */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-purple-500/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
              Deadline &amp; SLA Calculation
            </h2>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              All SLA deadlines and task due dates are calculated using this calendar. Business hours skip:
            </p>
            <ul className="space-y-2">
              {[
                { icon: "🌙", label: "Nights (before start / after end time)" },
                { icon: "📅", label: `Weekends (${[0, 6].filter(d => !cal.workDays.includes(d)).map(d => DAY_FULL[d]).join(" & ") || "none configured"})` },
                { icon: "🎉", label: `Public holidays (${cal.holidays.length} configured)` },
              ].map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
              Example: A task with an 8-hour SLA starting Friday at 4 PM ({HOURS[cal.workdayEnd - 1]?.label ?? `${cal.workdayEnd}:00`} end) will be due Monday at{" "}
              {HOURS[cal.workdayStart + 7]?.label ?? `${cal.workdayStart + 7}:00`} (skipping the weekend).
            </div>
          </div>
        </div>
      </div>

      {/* Public Holidays */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-red-500/5 to-transparent flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
            Public Holidays
          </h2>
          <button
            onClick={() => setAddingHoliday(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Holiday
          </button>
        </div>

        {/* Add holiday form */}
        {addingHoliday && (
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Holiday Name</label>
                <input
                  type="text"
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Jamhuri Day"
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                />
              </div>
              <div className="min-w-[140px]">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer h-9 px-1">
                <input
                  type="checkbox"
                  checked={newHoliday.recurring}
                  onChange={(e) => setNewHoliday((p) => ({ ...p, recurring: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 accent-[#02773b]"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Annual</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={addHoliday}
                  disabled={!newHoliday.name.trim() || !newHoliday.date}
                  className="h-9 px-4 rounded-lg bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => { setAddingHoliday(false); setNewHoliday({ name: "", date: "", recurring: false }); }}
                  className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {cal.holidays.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No holidays configured. Add public holidays to exclude them from SLA and deadline calculations.
            </div>
          ) : (
            cal.holidays
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((h, i) => {
                const originalIdx = cal.holidays.indexOf(h);
                const dt = new Date(h.date + "T12:00:00");
                const formatted = dt.toLocaleDateString("en-KE", {
                  weekday: "short", day: "numeric", month: "long", year: "numeric",
                });
                return (
                  <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{h.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatted}
                          {h.recurring && (
                            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 text-xs">
                              Annual
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeHoliday(originalIdx)}
                      className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove holiday"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <button
          onClick={load}
          className="h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] disabled:opacity-60 transition-colors shadow-md shadow-[#02773b]/20"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          )}
          {saving ? "Saving…" : "Save Calendar"}
        </button>
      </div>
    </div>
  );
}
