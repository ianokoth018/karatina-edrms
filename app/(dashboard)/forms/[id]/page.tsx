"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";

/* ================================================================
   Types
   ================================================================ */

interface FormFieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
}

interface FormFieldCondition {
  fieldId: string;
  operator: "equals" | "not_equals" | "contains" | "not_empty" | "empty";
  value?: string;
}

interface FormFieldOption {
  label: string;
  value: string;
}

interface TableColumn {
  label: string;
  name: string;
  type: string;
}

interface FormField {
  id: string;
  type: string;
  label: string;
  name: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  defaultValue?: any;
  width?: "full" | "half";
  validation?: FormFieldValidation;
  options?: FormFieldOption[];
  condition?: FormFieldCondition;
  tableColumns?: TableColumn[];
}

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  fields: FormField[];
  isActive: boolean;
  version: number;
}

/* ================================================================
   Condition evaluation
   ================================================================ */

function evaluateCondition(
  condition: FormFieldCondition,
  formData: Record<string, any>,
  fields: FormField[]
): boolean {
  const targetField = fields.find((f) => f.id === condition.fieldId);
  if (!targetField) return true;
  const val = formData[targetField.name];
  const strVal = val == null ? "" : String(val);

  switch (condition.operator) {
    case "equals":
      return strVal === (condition.value ?? "");
    case "not_equals":
      return strVal !== (condition.value ?? "");
    case "contains":
      return strVal.includes(condition.value ?? "");
    case "not_empty":
      return strVal.length > 0;
    case "empty":
      return strVal.length === 0;
    default:
      return true;
  }
}

/* ================================================================
   Validation
   ================================================================ */

function validateField(
  field: FormField,
  value: any
): string | null {
  if (field.type === "section" || field.type === "divider") return null;

  const strVal = value == null ? "" : String(value);

  if (field.required && strVal.trim() === "") {
    return `${field.label} is required`;
  }

  if (!strVal) return null;

  if (field.validation) {
    const v = field.validation;

    if (field.type === "number" || field.type === "table") {
      const num = Number(value);
      if (v.min != null && num < v.min) return `Minimum value is ${v.min}`;
      if (v.max != null && num > v.max) return `Maximum value is ${v.max}`;
    }

    if (v.minLength != null && strVal.length < v.minLength) {
      return `Minimum ${v.minLength} characters required`;
    }
    if (v.maxLength != null && strVal.length > v.maxLength) {
      return `Maximum ${v.maxLength} characters allowed`;
    }

    if (v.pattern) {
      try {
        const re = new RegExp(v.pattern);
        if (!re.test(strVal)) {
          return v.patternMessage ?? `Invalid format`;
        }
      } catch {
        /* ignore broken regex */
      }
    }
  }

  if (field.type === "email" && strVal) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
      return "Please enter a valid email address";
    }
  }

  return null;
}

/* ================================================================
   SVG Icons (inline to keep self-contained)
   ================================================================ */

function IconBack() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function IconSuccessBig() {
  return (
    <svg className="w-16 h-16 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg className="w-16 h-16 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

/* ================================================================
   Shared input class names
   ================================================================ */

const INPUT_BASE =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 " +
  "px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] " +
  "disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

const INPUT_ERROR =
  "border-red-400 dark:border-red-500 focus:ring-red-400/40 focus:border-red-400";

function inputCls(hasError: boolean): string {
  return hasError ? `${INPUT_BASE} ${INPUT_ERROR}` : INPUT_BASE;
}

/* ================================================================
   Multi-select dropdown component
   ================================================================ */

function MultiSelectField({
  field,
  value,
  onChange,
  hasError,
}: {
  field: FormField;
  value: string[];
  onChange: (v: string[]) => void;
  hasError: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(optVal: string) {
    if (value.includes(optVal)) {
      onChange(value.filter((v) => v !== optVal));
    } else {
      onChange([...value, optVal]);
    }
  }

  const selectedLabels = (field.options ?? [])
    .filter((o) => value.includes(o.value))
    .map((o) => o.label);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !field.readOnly && setOpen(!open)}
        className={`${inputCls(hasError)} text-left flex items-center justify-between gap-2`}
        disabled={field.readOnly}
      >
        <span className={selectedLabels.length ? "" : "text-gray-400 dark:text-gray-500"}>
          {selectedLabels.length ? selectedLabels.join(", ") : field.placeholder || "Select options..."}
        </span>
        <svg className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {(field.options ?? []).map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm text-gray-900 dark:text-gray-100"
            >
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/40"
              />
              {opt.label}
            </label>
          ))}
          {(field.options ?? []).length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No options available</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   File field with drag zone
   ================================================================ */

function FileField({
  field,
  value,
  onChange,
  hasError,
}: {
  field: FormField;
  value: File | null;
  onChange: (f: File | null) => void;
  hasError: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (field.readOnly) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onChange(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !field.readOnly && inputRef.current?.click()}
      className={`relative rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-[#02773b] bg-[#02773b]/5"
          : hasError
          ? "border-red-400 dark:border-red-500 bg-red-50/50 dark:bg-red-950/10"
          : "border-gray-300 dark:border-gray-700 hover:border-[#02773b]/50 bg-gray-50 dark:bg-gray-900/50"
      } ${field.readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={field.readOnly}
        onChange={(e) => {
          const file = e.target.files?.[0];
          onChange(file ?? null);
        }}
      />
      <div className="flex flex-col items-center gap-2">
        <div className="text-gray-400 dark:text-gray-500">
          <IconUpload />
        </div>
        {value ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{value.name}</p>
            <p className="text-xs text-gray-500">{(value.size / 1024).toFixed(1)} KB</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="text-xs text-red-500 hover:text-red-600 font-medium"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-[#02773b]">Click to upload</span> or drag and drop
            </p>
            {field.placeholder && (
              <p className="text-xs text-gray-400 mt-1">{field.placeholder}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Table field with repeatable rows
   ================================================================ */

function TableField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: Record<string, any>[];
  onChange: (rows: Record<string, any>[]) => void;
}) {
  const columns = field.tableColumns ?? [];

  function addRow() {
    const empty: Record<string, any> = {};
    columns.forEach((c) => (empty[c.name] = ""));
    onChange([...value, empty]);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updateCell(rowIdx: number, colName: string, cellVal: string) {
    const next = value.map((row, i) =>
      i === rowIdx ? { ...row, [colName]: cellVal } : row
    );
    onChange(next);
  }

  function cellType(colType: string): string {
    if (colType === "number") return "number";
    if (colType === "email") return "email";
    if (colType === "date") return "date";
    return "text";
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/60">
              {columns.map((col) => (
                <th
                  key={col.name}
                  className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {value.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 text-sm"
                >
                  No rows added yet
                </td>
              </tr>
            )}
            {value.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                {columns.map((col) => (
                  <td key={col.name} className="px-2 py-1.5">
                    <input
                      type={cellType(col.type)}
                      value={row[col.name] ?? ""}
                      onChange={(e) => updateCell(rIdx, col.name, e.target.value)}
                      className={`${INPUT_BASE} py-1.5 text-xs`}
                      readOnly={field.readOnly}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  {!field.readOnly && (
                    <button
                      type="button"
                      onClick={() => removeRow(rIdx)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Remove row"
                    >
                      <IconTrash />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!field.readOnly && (
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 transition-colors"
        >
          <IconPlus />
          Add Row
        </button>
      )}
    </div>
  );
}

/* ================================================================
   Main page component
   ================================================================ */

export default function FormFillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  /* ----- state ----- */
  const [form, setForm] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ----- fetch form template ----- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/forms/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "FORM_NOT_FOUND" : `Failed to load form (${res.status})`);
        return res.json();
      })
      .then((data: FormTemplate) => {
        if (cancelled) return;
        setForm(data);

        /* initialise form data with defaults */
        const defaults: Record<string, any> = {};
        data.fields.forEach((f) => {
          if (f.type === "section" || f.type === "divider") return;
          if (f.type === "table") {
            defaults[f.name] = f.defaultValue ?? [];
          } else if (f.type === "checkbox" || f.type === "multiselect") {
            defaults[f.name] = f.defaultValue ?? [];
          } else {
            defaults[f.name] = f.defaultValue ?? "";
          }
        });
        setFormData(defaults);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  /* ----- helpers ----- */
  const setField = useCallback((name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  function isFieldVisible(field: FormField): boolean {
    if (field.hidden) return false;
    if (!field.condition) return true;
    return evaluateCondition(field.condition, formData, form?.fields ?? []);
  }

  /* ----- submit ----- */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    /* validate */
    const errors: Record<string, string> = {};
    form.fields.forEach((field) => {
      if (!isFieldVisible(field)) return;
      const err = validateField(field, formData[field.name]);
      if (err) errors[field.name] = err;
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      /* scroll to first error */
      const firstKey = Object.keys(errors)[0];
      const el = document.querySelector(`[data-field="${firstKey}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    setSubmitError(null);

    /* collect only visible field data */
    const payload: Record<string, any> = {};
    form.fields.forEach((field) => {
      if (field.type === "section" || field.type === "divider") return;
      if (!isFieldVisible(field)) return;
      payload[field.name] = formData[field.name];
    });

    fetch(`/api/forms/${id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Submission failed (${res.status})`);
        return res.json();
      })
      .then(() => {
        setSubmitted(true);
      })
      .catch((err) => {
        setSubmitError(err.message);
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  function resetForm() {
    if (!form) return;
    const defaults: Record<string, any> = {};
    form.fields.forEach((f) => {
      if (f.type === "section" || f.type === "divider") return;
      if (f.type === "table") {
        defaults[f.name] = f.defaultValue ?? [];
      } else if (f.type === "checkbox" || f.type === "multiselect") {
        defaults[f.name] = f.defaultValue ?? [];
      } else {
        defaults[f.name] = f.defaultValue ?? "";
      }
    });
    setFormData(defaults);
    setFieldErrors({});
    setSubmitted(false);
    setSubmitError(null);
  }

  /* ================================================================
     Render: loading state
     ================================================================ */
  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* skeleton header */}
          <div className="space-y-3">
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-8 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-96 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          </div>
          {/* skeleton fields */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800/60 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
     Render: error / not found / inactive
     ================================================================ */
  if (error || !form) {
    const isNotFound = error === "FORM_NOT_FOUND";
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <IconWarning />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mx-auto">
            {isNotFound ? "Form Not Found" : "Error Loading Form"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isNotFound
              ? "The form you are looking for does not exist or has been removed."
              : error}
          </p>
          <Link
            href="/forms"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors"
          >
            <IconBack />
            Back to Forms
          </Link>
        </div>
      </div>
    );
  }

  if (!form.isActive) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <IconWarning />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mx-auto">
            Form Unavailable
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This form is currently inactive and not accepting submissions.
          </p>
          <Link
            href="/forms"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors"
          >
            <IconBack />
            Back to Forms
          </Link>
        </div>
      </div>
    );
  }

  /* ================================================================
     Render: success state
     ================================================================ */
  if (submitted) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-5">
          <div className="flex justify-center">
            <IconSuccessBig />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Submission Successful
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your response to <span className="font-medium text-gray-700 dark:text-gray-300">{form.name}</span> has been submitted successfully.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={resetForm}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 transition-colors"
            >
              Submit Another
            </button>
            <Link
              href="/forms"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors"
            >
              Back to Forms
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
     Field renderer
     ================================================================ */
  function renderField(field: FormField) {
    if (!isFieldVisible(field)) return null;

    const err = fieldErrors[field.name];
    const val = formData[field.name];

    /* --- section header --- */
    if (field.type === "section") {
      return (
        <div key={field.id} className="col-span-full pt-4 first:pt-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-2">
            {field.label}
          </h3>
          {field.helpText && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{field.helpText}</p>
          )}
        </div>
      );
    }

    /* --- divider --- */
    if (field.type === "divider") {
      return (
        <div key={field.id} className="col-span-full">
          <hr className="border-gray-200 dark:border-gray-800" />
        </div>
      );
    }

    /* --- wrapper for input fields --- */
    const widthCls = field.width === "half" ? "col-span-1" : "col-span-full";

    return (
      <div key={field.id} data-field={field.name} className={`${widthCls} space-y-1.5`}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>

        {/* --- text --- */}
        {field.type === "text" && (
          <input
            type="text"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            readOnly={field.readOnly}
            maxLength={field.validation?.maxLength}
            className={inputCls(!!err)}
          />
        )}

        {/* --- textarea --- */}
        {field.type === "textarea" && (
          <textarea
            rows={3}
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            readOnly={field.readOnly}
            maxLength={field.validation?.maxLength}
            className={inputCls(!!err)}
          />
        )}

        {/* --- richtext --- */}
        {field.type === "richtext" && (
          <div className="space-y-1">
            <textarea
              rows={5}
              value={val ?? ""}
              onChange={(e) => setField(field.name, e.target.value)}
              placeholder={field.placeholder}
              readOnly={field.readOnly}
              maxLength={field.validation?.maxLength}
              className={inputCls(!!err)}
            />
            <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Rich text formatting supported</p>
          </div>
        )}

        {/* --- number --- */}
        {field.type === "number" && (
          <input
            type="number"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            readOnly={field.readOnly}
            min={field.validation?.min}
            max={field.validation?.max}
            className={inputCls(!!err)}
          />
        )}

        {/* --- email --- */}
        {field.type === "email" && (
          <input
            type="email"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            readOnly={field.readOnly}
            className={inputCls(!!err)}
          />
        )}

        {/* --- phone --- */}
        {field.type === "phone" && (
          <input
            type="tel"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            placeholder={field.placeholder}
            readOnly={field.readOnly}
            className={inputCls(!!err)}
          />
        )}

        {/* --- date --- */}
        {field.type === "date" && (
          <input
            type="date"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            readOnly={field.readOnly}
            className={inputCls(!!err)}
          />
        )}

        {/* --- datetime --- */}
        {field.type === "datetime" && (
          <input
            type="datetime-local"
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            readOnly={field.readOnly}
            className={inputCls(!!err)}
          />
        )}

        {/* --- select --- */}
        {field.type === "select" && (
          <select
            value={val ?? ""}
            onChange={(e) => setField(field.name, e.target.value)}
            disabled={field.readOnly}
            className={inputCls(!!err)}
          >
            <option value="">{field.placeholder || "Select an option..."}</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}

        {/* --- multiselect --- */}
        {field.type === "multiselect" && (
          <MultiSelectField
            field={field}
            value={Array.isArray(val) ? val : []}
            onChange={(v) => setField(field.name, v)}
            hasError={!!err}
          />
        )}

        {/* --- radio --- */}
        {field.type === "radio" && (
          <div className="space-y-2 pt-1">
            {(field.options ?? []).map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={field.name}
                  value={opt.value}
                  checked={val === opt.value}
                  onChange={() => setField(field.name, opt.value)}
                  disabled={field.readOnly}
                  className="text-[#02773b] focus:ring-[#02773b]/40 border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
              </label>
            ))}
          </div>
        )}

        {/* --- checkbox group --- */}
        {field.type === "checkbox" && (
          <div className="space-y-2 pt-1">
            {(field.options ?? []).map((opt) => {
              const arr = Array.isArray(val) ? val : [];
              return (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={arr.includes(opt.value)}
                    onChange={() => {
                      if (arr.includes(opt.value)) {
                        setField(field.name, arr.filter((v: string) => v !== opt.value));
                      } else {
                        setField(field.name, [...arr, opt.value]);
                      }
                    }}
                    disabled={field.readOnly}
                    className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/40"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
                </label>
              );
            })}
          </div>
        )}

        {/* --- file --- */}
        {field.type === "file" && (
          <FileField
            field={field}
            value={val instanceof File ? val : null}
            onChange={(f) => setField(field.name, f)}
            hasError={!!err}
          />
        )}

        {/* --- table --- */}
        {field.type === "table" && (
          <TableField
            field={field}
            value={Array.isArray(val) ? val : []}
            onChange={(rows) => setField(field.name, rows)}
          />
        )}

        {/* help text */}
        {field.helpText && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{field.helpText}</p>
        )}

        {/* inline error */}
        {err && (
          <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            {err}
          </p>
        )}
      </div>
    );
  }

  /* ================================================================
     Render: form
     ================================================================ */
  const totalRequired = form.fields.filter(
    (f) => f.required && isFieldVisible(f) && f.type !== "section" && f.type !== "divider"
  ).length;

  return (
    <div className="p-4 sm:p-6 animate-fade-in">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* ---- header ---- */}
        <div className="space-y-3">
          <Link
            href="/forms"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-[#02773b] transition-colors"
          >
            <IconBack />
            Back to Forms
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {form.name}
              </h1>
              {form.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{form.description}</p>
              )}
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#dd9f42]/15 text-[#dd9f42] border border-[#dd9f42]/20">
              v{form.version}
            </span>
          </div>

          {totalRequired > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              <span className="text-red-500">*</span> indicates required fields
            </p>
          )}
        </div>

        {/* ---- form ---- */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
              {form.fields.map((field) => renderField(field))}
            </div>
          </div>

          {/* submit error banner */}
          {submitError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {submitError}
            </div>
          )}

          {/* validation summary */}
          {Object.keys(fieldErrors).length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
              Please fix {Object.keys(fieldErrors).length} error{Object.keys(fieldErrors).length > 1 ? "s" : ""} above before submitting.
            </div>
          )}

          {/* actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Link
              href="/forms"
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <IconSpinner />
                  Submitting...
                </>
              ) : (
                <>
                  <IconCheck />
                  Submit
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
