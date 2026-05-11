"use client";

/**
 * FormRenderer — canonical runtime form renderer.
 *
 * Used by:
 *   - /forms/[id]            (standalone form fill)
 *   - /workflows/tasks/[id]  (task completion form)
 *   - /forms/designer        (preview mode)
 *
 * Handles every field type the designer can produce, including dynamic
 * data-source options (departments / roles / users / casefolders / api)
 * and conditional visibility.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormField {
  id: string;
  type: string;
  label: string;
  name: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  defaultValue?: unknown;
  width?: "full" | "half";
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    patternMessage?: string;
    /** Cross-field comparison rules — evaluated live as the user types. */
    crossFieldRules?: CrossFieldRule[];
    /**
     * Earliest selectable date for date/datetime fields.
     * Supports ISO date strings (YYYY-MM-DD) or special tokens:
     * "today", "startOfYear", "startOfFinancialYear" (Jul 1 for KE), "startOfMonth".
     */
    minDate?: string;
    /**
     * Latest selectable date for date/datetime fields.
     * Supports ISO strings or tokens: "today", "endOfYear", "endOfFinancialYear", "endOfMonth".
     */
    maxDate?: string;
  };
  options?: FormFieldOption[];
  condition?: {
    fieldId: string;
    operator: "equals" | "not_equals" | "contains" | "not_empty" | "empty";
    value?: string;
  };
  tableColumns?: { label: string; name: string; type: string }[];
  dataSource?: {
    type: "departments" | "users" | "roles" | "casefolders" | "api";
    endpoint?: string;
    labelField?: string;
    valueField?: string;
    dependsOn?: string; // field.name this depends on (e.g. a department picker)
    /** When true, pre-filter users to the submitter's own department (ignores dependsOn). */
    filterByMyDepartment?: boolean;
  };
  maxUsers?: number;
  /** When true, user_picker/multi_user_picker skip the dept dropdown and pre-filter to the submitter's department. */
  filterByMyDepartment?: boolean;
  fieldLevel?: "casefolder" | "document";
  /** Auto-populate this field with the current user's profile data on form load. */
  autoFill?: "user.name" | "user.email" | "user.employeeId" | "user.jobTitle" | "user.department" | "user.phone";
  /** Auto-calculate this number field from two date fields using business-day logic. */
  autoCalculate?: {
    type: "businessDays";
    startField: string;
    endField: string;
  };
  /**
   * Look up a value from a FormData dataset and auto-populate this field.
   * The lookup fires whenever `matchField` changes.
   *
   * Built-in filter tokens (resolved automatically):
   *   "user.employeeId" — current user's employee ID
   *   "user.department" — current user's department
   *   "currentYear"     — current calendar year as a string
   *
   * Any other filter value is treated as a form field name and its current
   * value is used.
   */
  lookupFormData?: {
    /** Slug of the FormDataSchema to query (e.g. "leave_balances") */
    slug: string;
    /** The field name in the dataset whose value to return (e.g. "days_remaining") */
    returnField: string;
    /**
     * The form field whose change triggers the lookup (e.g. "type_of_leave").
     * Its current value is sent as `filter_{matchDatasetField}`.
     */
    matchField: string;
    /**
     * The dataset field name to match `matchField` value against.
     * Defaults to the same name as `matchField` when omitted.
     */
    matchDatasetField?: string;
    /**
     * Additional static filters applied to every lookup.
     * Values can be "user.employeeId", "user.department", "currentYear",
     * or any form field name.
     */
    extraFilters?: Record<string, string>;
  };
}

/**
 * A rule that compares this field's value against another field's value.
 * The rule reads: "this field must satisfy: thisValue [operator] otherValue".
 * An error is shown when the condition is VIOLATED.
 */
export interface CrossFieldRule {
  /** field.name of the field to compare against */
  compareTo: string;
  /** Comparison operator — evaluated as: thisField [operator] compareTo */
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  /** Error message shown when the rule is violated */
  message: string;
}

export interface FormRendererProps {
  fields: FormField[];
  formData: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  errors?: Record<string, string>;
  /** Force all fields read-only (e.g. review step) */
  readOnly?: boolean;
  /**
   * Per-field override from the workflow node config.
   * "hidden" | "readonly" | "editable" — overrides field.hidden / field.readOnly.
   */
  fieldConfig?: Record<string, "hidden" | "readonly" | "editable" | "visible">;
  /**
   * Called whenever cross-field validation state changes.
   * Pass a handler to disable your submit button when hasErrors = true.
   */
  onValidationChange?: (hasErrors: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function evaluateCondition(
  condition: NonNullable<FormField["condition"]>,
  formData: Record<string, unknown>,
  fields: FormField[]
): boolean {
  // Condition stores the referenced field's id; values are keyed by field.name
  const target = fields.find((f) => f.id === condition.fieldId);
  if (!target) return true;
  const raw = formData[target.name];
  const str = raw == null ? "" : Array.isArray(raw) ? (raw as string[]).join(",") : String(raw);
  switch (condition.operator) {
    case "equals":     return str === (condition.value ?? "");
    case "not_equals": return str !== (condition.value ?? "");
    case "contains":   return str.includes(condition.value ?? "");
    case "not_empty":  return str.length > 0;
    case "empty":      return str.length === 0;
    default:           return true;
  }
}

async function loadOptions(
  ds: NonNullable<FormField["dataSource"]>,
  depValue?: string,
  myDepartment?: string
): Promise<FormFieldOption[]> {
  try {
    if (ds.type === "departments") {
      const res = await fetch("/api/users/search?departments=true&limit=500");
      if (!res.ok) return [];
      const data = await res.json();
      return (data.departments as { name: string }[]).map((d) => ({ label: d.name, value: d.name }));
    }

    if (ds.type === "roles") {
      const res = await fetch("/api/users/search?roles=true");
      if (!res.ok) return [];
      const data = await res.json();
      return (data.roles as { id: string; name: string }[]).map((r) => ({ label: r.name, value: r.id }));
    }

    if (ds.type === "users") {
      const qs = new URLSearchParams({ limit: "200" });
      const dept = ds.filterByMyDepartment ? myDepartment : depValue;
      if (dept) qs.set("department", dept);
      const res = await fetch(`/api/users/search?${qs}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.users as { id: string; displayName?: string; name?: string }[]).map((u) => ({
        label: u.displayName ?? u.name ?? u.id,
        value: u.id,
      }));
    }

    if (ds.type === "casefolders") {
      const res = await fetch("/api/casefolders?limit=200");
      if (!res.ok) return [];
      const data = await res.json();
      const lf = ds.labelField ?? "name";
      const vf = ds.valueField ?? "id";
      const arr: Record<string, unknown>[] = data.casefolders ?? data ?? [];
      return arr.map((c) => ({ label: String(c[lf] ?? ""), value: String(c[vf] ?? "") }));
    }

    if (ds.type === "api" && ds.endpoint) {
      const res = await fetch(ds.endpoint);
      if (!res.ok) return [];
      const data = await res.json();
      const lf = ds.labelField ?? "name";
      const vf = ds.valueField ?? "id";
      const arr: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : (data.items ?? data.data ?? data.results ?? []);
      return arr.map((item) => ({ label: String(item[lf] ?? ""), value: String(item[vf] ?? "") }));
    }
  } catch {
    // silent — show empty options rather than crashing
  }
  return [];
}

// ---------------------------------------------------------------------------
// Sub-field components
// ---------------------------------------------------------------------------

const INPUT_BASE =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 " +
  "px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] " +
  "disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

const INPUT_ERR = "border-red-400 dark:border-red-500 focus:ring-red-400/40 focus:border-red-400";
function icls(err: boolean) { return err ? `${INPUT_BASE} ${INPUT_ERR}` : INPUT_BASE; }

// --- MultiSelect ---
function MultiSelectField({
  options, value, onChange, placeholder, readOnly, hasError,
}: {
  options: FormFieldOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  readOnly?: boolean;
  hasError: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const labels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && setOpen((p) => !p)}
        className={`${icls(hasError)} text-left flex items-center justify-between gap-2`}
      >
        <span className={labels.length ? "" : "text-gray-400 dark:text-gray-500"}>
          {labels.length ? labels.join(", ") : placeholder || "Select options..."}
        </span>
        <svg className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => {
                  const next = value.includes(opt.value)
                    ? value.filter((v) => v !== opt.value)
                    : [...value, opt.value];
                  onChange(next);
                }}
                className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/40"
              />
              <span className="text-gray-900 dark:text-gray-100">{opt.label}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No options available</div>
          )}
        </div>
      )}
    </div>
  );
}

// --- UserPickerField ---
function UserPickerField({
  field, value, onChange, readOnly, hasError,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  hasError: boolean;
}) {
  const { data: session } = useSession();
  const myDept = field.filterByMyDepartment ? (session?.user?.department ?? "") : "";

  const [dept, setDept] = useState(myDept);
  const [depts, setDepts] = useState<FormFieldOption[]>([]);
  const [users, setUsers] = useState<FormFieldOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Keep dept in sync when session loads (filterByMyDepartment mode)
  useEffect(() => {
    if (field.filterByMyDepartment && myDept) setDept(myDept);
  }, [field.filterByMyDepartment, myDept]);

  useEffect(() => {
    if (field.filterByMyDepartment) return; // no need to load all departments
    fetch("/api/users/search?departments=true&limit=500")
      .then((r) => r.ok ? r.json() : { departments: [] })
      .then((d) => setDepts((d.departments as { name: string }[]).map((x) => ({ label: x.name, value: x.name }))))
      .catch(() => {});
  }, [field.filterByMyDepartment]);

  useEffect(() => {
    if (!dept) { setUsers([]); return; }
    setLoadingUsers(true);
    fetch(`/api/users/search?department=${encodeURIComponent(dept)}&limit=200`)
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d) => setUsers((d.users as { id: string; displayName?: string; name?: string }[]).map((u) => ({
        label: u.displayName ?? u.name ?? u.id, value: u.id,
      }))))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [dept]);

  return (
    <div className="space-y-2">
      {field.filterByMyDepartment ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          Showing members of: <span className="font-medium not-italic text-gray-700 dark:text-gray-300">{dept || "loading…"}</span>
        </p>
      ) : (
        <select
          value={dept}
          onChange={(e) => { setDept(e.target.value); onChange(""); }}
          disabled={readOnly}
          className={icls(false)}
        >
          <option value="">Select department...</option>
          {depts.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly || !dept || loadingUsers}
        className={icls(hasError)}
      >
        <option value="">{loadingUsers ? "Loading…" : (dept ? "Select user…" : "Select department first")}</option>
        {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </div>
  );
}

// --- MultiUserPickerField ---
function MultiUserPickerField({
  field, value, onChange, readOnly, hasError,
}: {
  field: FormField;
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  hasError: boolean;
}) {
  const { data: session } = useSession();
  const myDept = field.filterByMyDepartment ? (session?.user?.department ?? "") : "";

  const [dept, setDept] = useState(myDept);
  const [depts, setDepts] = useState<FormFieldOption[]>([]);
  const [users, setUsers] = useState<FormFieldOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const max = field.maxUsers ?? 5;

  // Keep dept in sync when session loads (filterByMyDepartment mode)
  useEffect(() => {
    if (field.filterByMyDepartment && myDept) setDept(myDept);
  }, [field.filterByMyDepartment, myDept]);

  useEffect(() => {
    if (field.filterByMyDepartment) return;
    fetch("/api/users/search?departments=true&limit=500")
      .then((r) => r.ok ? r.json() : { departments: [] })
      .then((d) => setDepts((d.departments as { name: string }[]).map((x) => ({ label: x.name, value: x.name }))))
      .catch(() => {});
  }, [field.filterByMyDepartment]);

  useEffect(() => {
    if (!dept) { setUsers([]); return; }
    setLoadingUsers(true);
    fetch(`/api/users/search?department=${encodeURIComponent(dept)}&limit=200`)
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((d) => setUsers((d.users as { id: string; displayName?: string; name?: string }[]).map((u) => ({
        label: u.displayName ?? u.name ?? u.id, value: u.id,
      }))))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [dept]);

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (value.length < max) {
      onChange([...value, id]);
    }
  }

  // Resolve display names for selected ids
  const selectedUsers = value.map((id) => {
    const found = users.find((u) => u.value === id);
    return { id, label: found?.label ?? id };
  });

  return (
    <div className={`rounded-lg border ${hasError ? "border-red-400 dark:border-red-500" : "border-gray-300 dark:border-gray-700"} bg-white dark:bg-gray-900 p-3 space-y-3`}>
      {/* Selected users as pills */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedUsers.map(({ id, label }) => (
            <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#02773b]/10 text-[#02773b] dark:text-green-400 text-xs font-medium">
              {label}
              {!readOnly && (
                <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} className="ml-0.5 hover:text-red-500 transition-colors">&times;</button>
              )}
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          {field.filterByMyDepartment ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Showing members of: <span className="font-medium not-italic text-gray-700 dark:text-gray-300">{dept || "loading…"}</span>
            </p>
          ) : (
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className={icls(false)}
            >
              <option value="">Select department...</option>
              {depts.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          )}
          {dept && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {loadingUsers && <p className="px-3 py-2 text-sm text-gray-400">Loading users…</p>}
              {!loadingUsers && users.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No users found</p>}
              {users.map((u) => {
                const selected = value.includes(u.value);
                const disabled = !selected && value.length >= max;
                return (
                  <label key={u.value} className={`flex items-center gap-2 px-3 py-2 text-sm ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => toggle(u.value)}
                      className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/40"
                    />
                    <span className="text-gray-900 dark:text-gray-100">{u.label}</span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 dark:text-gray-500 text-right">{value.length}/{max} selected</p>
        </>
      )}
    </div>
  );
}

// --- FileField ---
function FileField({
  field, value, onChange, readOnly, hasError,
}: {
  field: FormField;
  value: File | null;
  onChange: (f: File | null) => void;
  readOnly?: boolean;
  hasError: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!readOnly) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!readOnly) { const f = e.dataTransfer.files?.[0]; if (f) onChange(f); } }}
      onClick={() => !readOnly && ref.current?.click()}
      className={`relative rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors
        ${dragging ? "border-[#02773b] bg-[#02773b]/5"
          : hasError ? "border-red-400 dark:border-red-500 bg-red-50/50 dark:bg-red-950/10"
          : "border-gray-300 dark:border-gray-700 hover:border-[#02773b]/50 bg-gray-50 dark:bg-gray-900/50"}
        ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input ref={ref} type="file" className="hidden" disabled={readOnly} onChange={(e) => { const f = e.target.files?.[0]; onChange(f ?? null); }} />
      <div className="flex flex-col items-center gap-2">
        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        {value ? (
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{value.name}</p>
            <p className="text-xs text-gray-500">{(value.size / 1024).toFixed(1)} KB</p>
            {!readOnly && <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>}
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium text-[#02773b]">Click to upload</span> or drag and drop</p>
            {field.placeholder && <p className="text-xs text-gray-400 mt-1">{field.placeholder}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- TableField ---
function TableField({
  field, value, onChange, readOnly,
}: {
  field: FormField;
  value: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
  readOnly?: boolean;
}) {
  const cols = field.tableColumns ?? [];
  const rows = value.length ? value : [{}];

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              {cols.map((c) => <th key={c.name} className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{c.label}</th>)}
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-gray-200 dark:border-gray-700">
                {cols.map((c) => (
                  <td key={c.name} className="px-3 py-1.5">
                    <input
                      type={c.type === "number" ? "number" : "text"}
                      value={String(row[c.name] ?? "")}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const next = [...rows];
                        next[ri] = { ...next[ri], [c.name]: e.target.value };
                        onChange(next);
                      }}
                      className="w-full h-8 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm outline-none focus:border-[#02773b] transition-colors disabled:opacity-60"
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1">
                    <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== ri))} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" onClick={() => { const r: Record<string, unknown> = {}; cols.forEach((c) => (r[c.name] = "")); onChange([...rows, r]); }} className="w-full py-1.5 text-xs text-[#02773b] hover:bg-[#02773b]/5 transition-colors border-t border-gray-200 dark:border-gray-700">
          + Add Row
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a minDate / maxDate token to an ISO date string (YYYY-MM-DD).
 * Supports static ISO dates or special tokens for common financial-year patterns.
 */
function resolveDateToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (token) {
    case "today":
      return iso(now);
    case "startOfYear":
      return `${now.getFullYear()}-01-01`;
    case "endOfYear":
      return `${now.getFullYear()}-12-31`;
    case "startOfMonth":
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    case "endOfMonth": {
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return iso(last);
    }
    // Kenyan financial year: July 1 – June 30
    case "startOfFinancialYear": {
      const fyStart = now.getMonth() >= 6
        ? new Date(now.getFullYear(), 6, 1)      // Jul 1 this year
        : new Date(now.getFullYear() - 1, 6, 1); // Jul 1 last year
      return iso(fyStart);
    }
    case "endOfFinancialYear": {
      const fyEnd = now.getMonth() >= 6
        ? new Date(now.getFullYear() + 1, 5, 30)  // Jun 30 next year
        : new Date(now.getFullYear(), 5, 30);      // Jun 30 this year
      return iso(fyEnd);
    }
    default:
      // Assume it's already an ISO date or field-relative expression
      return token;
  }
}

// ---------------------------------------------------------------------------
// FormRenderer
// ---------------------------------------------------------------------------

export function FormRenderer({
  fields, formData, onChange, errors = {}, readOnly = false, fieldConfig = {}, onValidationChange,
}: FormRendererProps) {
  const { data: session } = useSession();
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, FormFieldOption[]>>({});

  // ------------------------------------------------------------------
  // Auto-fill fields from the current user's profile on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!session?.user) return;
    const u = session.user;
    const autoFillMap: Record<string, string> = {
      "user.name": u.name ?? "",
      "user.email": u.email ?? "",
      "user.employeeId": u.employeeId ?? "",
      "user.jobTitle": u.jobTitle ?? "",
      "user.department": u.department ?? "",
      "user.phone": u.phone ?? "",
    };
    for (const field of fields) {
      if (!field.autoFill) continue;
      const autoVal = autoFillMap[field.autoFill];
      if (autoVal && !formData[field.name]) {
        onChange(field.name, autoVal);
      }
    }
  // Only run once on mount / when session becomes available
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ------------------------------------------------------------------
  // Auto-calculate business days for number fields with autoCalculate config
  // ------------------------------------------------------------------
  const [calculatingFields, setCalculatingFields] = useState<Set<string>>(new Set());

  const autoCalcFields = useMemo(
    () => fields.filter((f) => f.autoCalculate?.type === "businessDays"),
    [fields]
  );

  useEffect(() => {
    if (autoCalcFields.length === 0) return;
    let cancelled = false;

    (async () => {
      // Fetch work calendar once
      let cal: { workingDays: number[]; holidays: { date: string; recurring?: boolean }[] } | null = null;
      try {
        const res = await fetch("/api/work-calendar");
        if (res.ok) cal = (await res.json()).calendar;
      } catch {
        // fall back to Mon–Fri, no holidays
      }

      const isWorkingDay = (d: Date): boolean => {
        const dow = d.getDay(); // 0=Sun
        const workingDays = Array.isArray(cal?.workingDays) ? cal!.workingDays : [1, 2, 3, 4, 5];
        if (!workingDays.includes(dow)) return false;
        const holidays = Array.isArray(cal?.holidays) ? cal!.holidays : [];
        const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const fullDate = `${d.getFullYear()}-${mmdd}`;
        for (const h of holidays) {
          if (h.recurring ? h.date === mmdd : h.date === fullDate) return false;
        }
        return true;
      };

      const calcBusinessDays = (start: string, end: string): number => {
        const s = new Date(start);
        const e = new Date(end);
        if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
        let count = 0;
        const cur = new Date(s);
        while (cur <= e) {
          if (isWorkingDay(cur)) count++;
          cur.setDate(cur.getDate() + 1);
        }
        return count;
      };

      for (const field of autoCalcFields) {
        if (!field.autoCalculate) continue;
        const startVal = String(formData[field.autoCalculate.startField] ?? "");
        const endVal = String(formData[field.autoCalculate.endField] ?? "");
        if (!startVal || !endVal) continue;
        const days = calcBusinessDays(startVal, endVal);
        if (cancelled) return;
        setCalculatingFields((prev) => { const s = new Set(prev); s.add(field.name); return s; });
        onChange(field.name, days);
        if (cancelled) return;
        setCalculatingFields((prev) => { const s = new Set(prev); s.delete(field.name); return s; });
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoCalcFields.length,
    // Watch start/end values for all auto-calc fields
    ...autoCalcFields.flatMap((f) => [
      formData[f.autoCalculate!.startField],
      formData[f.autoCalculate!.endField],
    ]),
  ]);

  // ------------------------------------------------------------------
  // lookupFormData — fetch a value from a FormData dataset whenever
  // the trigger field changes (e.g. leave type → leave balance)
  // ------------------------------------------------------------------

  const lookupFields = useMemo(
    () => fields.filter((f) => !!f.lookupFormData?.slug && !!f.lookupFormData?.returnField && !!f.lookupFormData?.matchField),
    [fields]
  );

  // Serialize trigger values to a stable string dep — avoids dynamic spread
  const lookupTriggerSerial = JSON.stringify(
    lookupFields.map((f) => [f.name, formData[f.lookupFormData!.matchField] ?? ""])
  );

  useEffect(() => {
    if (lookupFields.length === 0) return;
    if (!session?.user) return;

    let cancelled = false;

    const u = session.user as {
      employeeId?: string; department?: string;
      [k: string]: unknown;
    };

    const tokenMap: Record<string, string> = {
      "user.employeeId": u.employeeId ?? "",
      "user.department": u.department ?? "",
      currentYear: String(new Date().getFullYear()),
    };

    const resolveToken = (token: string): string => {
      if (token in tokenMap) return tokenMap[token];
      return String(formData[token] ?? "");
    };

    (async () => {
      for (const field of lookupFields) {
        const cfg = field.lookupFormData!;
        const triggerValue = String(formData[cfg.matchField] ?? "").trim();

        // Clear when trigger is empty
        if (!triggerValue) {
          if (!cancelled) onChange(field.name, "");
          continue;
        }

        // Don't query if required extra filter values are missing
        const extraEntries = Object.entries(cfg.extraFilters ?? {});
        const resolvedExtras = extraEntries.map(([k, v]) => [k, resolveToken(v)] as [string, string]);
        const missingRequired = resolvedExtras.some(([, v]) => !v);
        if (missingRequired) continue;

        try {
          const qs = new URLSearchParams();
          // Primary match
          const datasetField = cfg.matchDatasetField?.trim() || cfg.matchField;
          qs.set(`filter_${datasetField}`, triggerValue);
          // Extra filters
          for (const [dsField, val] of resolvedExtras) {
            if (val) qs.set(`filter_${dsField}`, val);
          }
          qs.set("limit", "10");

          const res = await fetch(`/api/form-data/${cfg.slug}?${qs}`);
          if (cancelled) return;
          if (!res.ok) { onChange(field.name, ""); continue; }

          const data = await res.json();
          const records = (data.records ?? []) as { data: Record<string, unknown> }[];
          const first = records[0];
          const val = first ? String(first.data[cfg.returnField] ?? "") : "";
          if (!cancelled) onChange(field.name, val);
        } catch {
          // silent — leave field empty
        }
      }
    })();

    return () => { cancelled = true; };
  // lookupTriggerSerial is a JSON string of [fieldName, triggerValue] pairs —
  // it changes whenever any trigger field value changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupTriggerSerial, session?.user?.id]);

  // ------------------------------------------------------------------
  // Cross-field validation — evaluated live on every formData change
  // ------------------------------------------------------------------

  const crossFieldErrors = useMemo<Record<string, string>>(() => {
    const errs: Record<string, string> = {};

    for (const field of fields) {
      const rules = field.validation?.crossFieldRules;
      if (!rules?.length) continue;

      const rawA = formData[field.name];
      if (rawA === undefined || rawA === null || rawA === "") continue;

      for (const rule of rules) {
        const rawB = formData[rule.compareTo];
        if (rawB === undefined || rawB === null || rawB === "") continue;

        // Coerce to comparable values
        // Detect dates (YYYY-MM-DD) vs numbers vs strings
        let a: number | string = String(rawA);
        let b: number | string = String(rawB);

        const isDateLike = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v);
        const isNumLike   = (v: string) => !isNaN(parseFloat(v)) && String(parseFloat(v)) === v.trim();

        if (isDateLike(a) && isDateLike(b)) {
          a = new Date(a).getTime();
          b = new Date(b).getTime();
        } else if (isNumLike(a) && isNumLike(b)) {
          a = parseFloat(a);
          b = parseFloat(b);
        }

        const violated =
          rule.operator === "gt"  ? !(a >  b) :
          rule.operator === "gte" ? !(a >= b) :
          rule.operator === "lt"  ? !(a <  b) :
          rule.operator === "lte" ? !(a <= b) :
          rule.operator === "eq"  ? !(a === b) :
          rule.operator === "neq" ? !(a !== b) :
          false;

        if (violated) {
          errs[field.name] = rule.message;
          break; // show the first violated rule per field
        }
      }
    }

    return errs;
  }, [fields, formData]);

  // Notify parent when cross-field error state changes
  const prevCrossFieldErrorCount = useMemo(
    () => Object.keys(crossFieldErrors).length,
    [crossFieldErrors]
  );
  useEffect(() => {
    onValidationChange?.(prevCrossFieldErrorCount > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevCrossFieldErrorCount]);

  // ------------------------------------------------------------------
  // Load dynamic options
  // ------------------------------------------------------------------

  // Fields that have a dataSource and no dependsOn and don't filter by session — load once on mount
  const staticDsFields = useMemo(
    () => fields.filter((f) => f.dataSource && !f.dataSource.dependsOn && !f.dataSource.filterByMyDepartment),
    [fields]
  );

  useEffect(() => {
    if (staticDsFields.length === 0) return;
    (async () => {
      const updates: Record<string, FormFieldOption[]> = {};
      await Promise.all(
        staticDsFields.map(async (f) => {
          updates[f.id] = await loadOptions(f.dataSource!);
        })
      );
      setDynamicOptions((prev) => ({ ...prev, ...updates }));
    })();
  }, [staticDsFields]);

  // Fields that filter by the submitter's own department — load once session is available
  const myDeptFields = useMemo(
    () => fields.filter((f) => f.dataSource?.filterByMyDepartment),
    [fields]
  );
  const myDepartment = session?.user?.department ?? "";

  useEffect(() => {
    if (myDeptFields.length === 0 || !myDepartment) return;
    (async () => {
      const updates: Record<string, FormFieldOption[]> = {};
      await Promise.all(
        myDeptFields.map(async (f) => {
          updates[f.id] = await loadOptions(f.dataSource!, undefined, myDepartment);
        })
      );
      setDynamicOptions((prev) => ({ ...prev, ...updates }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDeptFields, myDepartment]);

  // Fields with dependsOn — re-fetch when the dependency value changes
  const depFields = useMemo(
    () => fields.filter((f) => f.dataSource?.dependsOn),
    [fields]
  );

  // Build a stable key from all dependency values so we can detect changes
  const depKey = useMemo(
    () => depFields.map((f) => String(formData[f.dataSource!.dependsOn!] ?? "")).join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [depFields, ...depFields.map((f) => formData[f.dataSource!.dependsOn!])]
  );

  useEffect(() => {
    if (depFields.length === 0) return;
    (async () => {
      const updates: Record<string, FormFieldOption[]> = {};
      await Promise.all(
        depFields.map(async (f) => {
          const depVal = String(formData[f.dataSource!.dependsOn!] ?? "");
          updates[f.id] = await loadOptions(f.dataSource!, depVal || undefined, myDepartment || undefined);
        })
      );
      setDynamicOptions((prev) => ({ ...prev, ...updates }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  // ------------------------------------------------------------------
  // Visibility
  // ------------------------------------------------------------------

  const isVisible = useCallback(
    (field: FormField): boolean => {
      const override = fieldConfig[field.name];
      if (override === "hidden") return false;
      if (field.hidden && override !== "visible" && override !== "editable" && override !== "readonly") return false;
      if (!field.condition) return true;
      return evaluateCondition(field.condition, formData, fields);
    },
    [fieldConfig, formData, fields]
  );

  const isReadOnly = useCallback(
    (field: FormField): boolean => {
      const override = fieldConfig[field.name];
      if (override === "readonly") return true;
      if (override === "editable") return false;
      return readOnly || !!field.readOnly;
    },
    [fieldConfig, readOnly]
  );

  // ------------------------------------------------------------------
  // Render a single field
  // ------------------------------------------------------------------

  function renderField(field: FormField) {
    if (!isVisible(field)) return null;

    const ro = isReadOnly(field);
    // External errors (from API / parent) take priority; fall back to live cross-field errors
    const err = errors[field.name] ?? crossFieldErrors[field.name] ?? "";
    const val = formData[field.name];

    // --- Layout types (no input) ---
    if (field.type === "section") {
      return (
        <div key={field.id} className="col-span-full pt-4 first:pt-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-2">{field.label}</h3>
          {field.helpText && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{field.helpText}</p>}
        </div>
      );
    }
    if (field.type === "divider") {
      return <div key={field.id} className="col-span-full"><hr className="border-gray-200 dark:border-gray-800" /></div>;
    }
    if (field.type === "step") {
      const stepNum = fields.filter((f) => f.type === "step").indexOf(field) + 1;
      return (
        <div key={field.id} className="col-span-full mt-6 mb-2">
          <div className="flex items-center gap-3 p-3 bg-[#02773b]/5 border border-[#02773b]/20 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-[#02773b] text-white flex items-center justify-center text-sm font-bold shrink-0">{stepNum}</div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{field.label}</h3>
              {field.helpText && <p className="text-xs text-gray-500 dark:text-gray-400">{field.helpText}</p>}
            </div>
          </div>
        </div>
      );
    }

    // Resolved options (static or dynamic)
    const opts: FormFieldOption[] = field.dataSource
      ? (dynamicOptions[field.id] ?? [])
      : (field.options ?? []);

    const widthCls = field.width === "half" ? "col-span-1" : "col-span-full";

    return (
      <div key={field.id} data-field={field.name} className={`${widthCls} space-y-1.5`}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>

        {/* text / email / phone / number / date / datetime / richtext */}
        {(field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "number" || field.type === "date" || field.type === "datetime" || field.type === "richtext") && (
          field.type === "richtext" ? (
            <textarea rows={4} value={String(val ?? "")} readOnly={ro} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} className={icls(!!err)} />
          ) : field.type === "number" && field.autoCalculate?.type === "businessDays" ? (
            <div className="flex items-center gap-2">
              <div className={`${icls(!!err)} flex-1 bg-gray-50 dark:bg-gray-800/60 cursor-default`}>
                {calculatingFields.has(field.name) ? (
                  <span className="text-gray-400 text-sm">Calculating...</span>
                ) : val !== "" && val !== undefined ? (
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{String(val)}</span>
                ) : (
                  <span className="text-gray-400 text-sm">Set start & end date</span>
                )}
              </div>
              <span className="text-[10px] font-medium text-[#02773b] bg-[#02773b]/10 px-2 py-1 rounded-full whitespace-nowrap">
                Auto-calculated
              </span>
            </div>
          ) : (
            <input
              type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
              value={String(val ?? "")}
              readOnly={ro}
              onChange={(e) => onChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              min={
                field.type === "date" || field.type === "datetime"
                  ? resolveDateToken(field.validation?.minDate)
                  : field.validation?.min
              }
              max={
                field.type === "date" || field.type === "datetime"
                  ? resolveDateToken(field.validation?.maxDate)
                  : field.validation?.max
              }
              maxLength={field.validation?.maxLength}
              className={icls(!!err)}
            />
          )
        )}

        {/* textarea */}
        {field.type === "textarea" && (
          <textarea rows={3} value={String(val ?? "")} readOnly={ro} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} maxLength={field.validation?.maxLength} className={icls(!!err)} />
        )}

        {/* select */}
        {field.type === "select" && (
          <select value={String(val ?? "")} disabled={ro} onChange={(e) => onChange(field.name, e.target.value)} className={icls(!!err)}>
            <option value="">{field.dataSource ? "Loading..." : (field.placeholder || "Select an option...")}</option>
            {opts.length > 0 && <option value="" disabled>{field.placeholder || "Select an option..."}</option>}
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}

        {/* multiselect */}
        {field.type === "multiselect" && (
          <MultiSelectField
            options={opts}
            value={Array.isArray(val) ? val as string[] : []}
            onChange={(v) => onChange(field.name, v)}
            placeholder={field.placeholder}
            readOnly={ro}
            hasError={!!err}
          />
        )}

        {/* radio */}
        {field.type === "radio" && (
          <div className="space-y-2 pt-1">
            {opts.map((o) => (
              <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name={field.name} value={o.value} checked={String(val ?? "") === o.value} disabled={ro} onChange={() => onChange(field.name, o.value)} className="text-[#02773b] focus:ring-[#02773b]/40 border-gray-300 dark:border-gray-600 accent-[#02773b]" />
                <span className="text-sm text-gray-700 dark:text-gray-300">{o.label}</span>
              </label>
            ))}
          </div>
        )}

        {/* checkbox group */}
        {field.type === "checkbox" && (
          <div className="space-y-2 pt-1">
            {opts.map((o) => {
              const arr = Array.isArray(val) ? val as string[] : [];
              return (
                <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={arr.includes(o.value)} disabled={ro} onChange={() => {
                    const next = arr.includes(o.value) ? arr.filter((v) => v !== o.value) : [...arr, o.value];
                    onChange(field.name, next);
                  }} className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/40 accent-[#02773b]" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{o.label}</span>
                </label>
              );
            })}
          </div>
        )}

        {/* file */}
        {field.type === "file" && (
          <FileField field={field} value={val instanceof File ? val : null} onChange={(f) => onChange(field.name, f)} readOnly={ro} hasError={!!err} />
        )}

        {/* table */}
        {field.type === "table" && (
          <TableField field={field} value={Array.isArray(val) ? val as Record<string, unknown>[] : []} onChange={(rows) => onChange(field.name, rows)} readOnly={ro} />
        )}

        {/* user_picker */}
        {field.type === "user_picker" && (
          <UserPickerField field={field} value={String(val ?? "")} onChange={(v) => onChange(field.name, v)} readOnly={ro} hasError={!!err} />
        )}

        {/* multi_user_picker */}
        {field.type === "multi_user_picker" && (
          <MultiUserPickerField field={field} value={Array.isArray(val) ? val as string[] : []} onChange={(v) => onChange(field.name, v)} readOnly={ro} hasError={!!err} />
        )}

        {field.helpText && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{field.helpText}</p>}
        {err && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{err}</p>}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
      {fields.map((field) => renderField(field))}
    </div>
  );
}
