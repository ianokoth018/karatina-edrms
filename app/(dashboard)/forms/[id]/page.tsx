"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { FormRenderer, FormField, evaluateCondition } from "@/components/forms/form-renderer";

/* ================================================================
   Types
   ================================================================ */

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  fields: FormField[];
  isActive: boolean;
  version: number;
}

const STEPS = [
  { num: 1, label: "Fill In" },
  { num: 2, label: "Review & Submit" },
];

/* ================================================================
   Validation
   ================================================================ */

function validateField(field: FormField, value: any): string | null {
  if (field.type === "section" || field.type === "divider") return null;
  const strVal = value == null ? "" : String(value);
  if (field.required && strVal.trim() === "") return `${field.label} is required`;
  if (!strVal) return null;
  if (field.validation) {
    const v = field.validation;
    if (field.type === "number" || field.type === "table") {
      const num = Number(value);
      if (v.min != null && num < v.min) return `Minimum value is ${v.min}`;
      if (v.max != null && num > v.max) return `Maximum value is ${v.max}`;
    }
    if (v.minLength != null && strVal.length < v.minLength) return `Minimum ${v.minLength} characters required`;
    if (v.maxLength != null && strVal.length > v.maxLength) return `Maximum ${v.maxLength} characters allowed`;
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern).test(strVal)) return v.patternMessage ?? "Invalid format";
      } catch { /* ignore */ }
    }
  }
  if (field.type === "email" && strVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal))
    return "Please enter a valid email address";
  return null;
}

/* ================================================================
   Review helpers — format a raw value into a human-readable string
   ================================================================ */

function formatValue(field: FormField, value: any): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (field.type === "date") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  if (field.type === "checkbox") return value ? "Yes" : "No";
  return String(value);
}

/* ================================================================
   Review panel — groups fields by section and shows label/value pairs
   ================================================================ */

function ReviewPanel({
  fields,
  formData,
  isVisible,
  onEdit,
}: {
  fields: FormField[];
  formData: Record<string, any>;
  isVisible: (f: FormField) => boolean;
  onEdit: () => void;
}) {
  // Split fields into sections
  type Section = { title: string | null; fields: FormField[] };
  const sections: Section[] = [];
  let current: Section = { title: null, fields: [] };

  for (const f of fields) {
    if (f.type === "divider") continue;
    if (f.type === "section") {
      if (current.fields.length) sections.push(current);
      current = { title: f.label, fields: [] };
    } else if (isVisible(f)) {
      current.fields.push(f);
    }
  }
  if (current.fields.length) sections.push(current);

  return (
    <div className="space-y-6">
      {sections.map((sec, si) => (
        <div key={si} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {sec.title && (
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {sec.title}
              </h3>
            </div>
          )}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {sec.fields.map((f) => (
              <div key={f.name} className="grid grid-cols-1 sm:grid-cols-2 gap-1 px-5 py-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide self-center">
                  {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                </span>
                <span className={`text-sm font-medium ${
                  formData[f.name] == null || formData[f.name] === "" || (Array.isArray(formData[f.name]) && !formData[f.name].length)
                    ? "text-gray-400 dark:text-gray-600 italic"
                    : "text-gray-900 dark:text-gray-100"
                }`}>
                  {formatValue(f, formData[f.name])}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Edit button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-sm text-[#02773b] hover:underline"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
          </svg>
          Edit answers
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   Icons
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
   Step indicator
   ================================================================ */

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done = s.num < step;
        const active = s.num === step;
        return (
          <div key={s.num} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold border-2 transition-colors ${
                done
                  ? "bg-[#02773b] border-[#02773b] text-white"
                  : active
                  ? "border-[#02773b] text-[#02773b] bg-white dark:bg-gray-900"
                  : "border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900"
              }`}>
                {done ? <IconCheck /> : s.num}
              </div>
              <span className={`text-sm font-medium hidden sm:block ${
                active ? "text-[#02773b]" : done ? "text-gray-600 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"
              }`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 sm:w-16 h-px mx-2 sm:mx-3 ${done ? "bg-[#02773b]" : "bg-gray-200 dark:bg-gray-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
   Main page component
   ================================================================ */

export default function FormFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [form, setForm] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [autoWorkflowId, setAutoWorkflowId] = useState<string | null>(null);
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
        const defaults: Record<string, any> = {};
        data.fields.forEach((f) => {
          if (f.type === "section" || f.type === "divider") return;
          if (f.type === "table") defaults[f.name] = f.defaultValue ?? [];
          else if (f.type === "checkbox" || f.type === "multiselect") defaults[f.name] = f.defaultValue ?? [];
          else defaults[f.name] = f.defaultValue ?? "";
        });
        setFormData(defaults);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const setField = useCallback((name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev }; delete next[name]; return next;
    });
  }, []);

  function isFieldVisible(field: FormField): boolean {
    if (field.hidden) return false;
    if (!field.condition) return true;
    return evaluateCondition(field.condition, formData, form?.fields ?? []);
  }

  /* ----- step 1 → 2: validate then advance ----- */
  function handleContinueToReview(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const errors: Record<string, string> = {};
    form.fields.forEach((field) => {
      if (!isFieldVisible(field)) return;
      const err = validateField(field, formData[field.name]);
      if (err) errors[field.name] = err;
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstKey = Object.keys(errors)[0];
      document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setFieldErrors({});
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ----- step 2: submit ----- */
  function handleSubmit() {
    if (!form) return;
    setSubmitting(true);
    setSubmitError(null);
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
      .then((result) => {
        setAutoWorkflowId(result.workflowInstanceId ?? null);
        setSubmitted(true);
      })
      .catch((err) => setSubmitError(err.message))
      .finally(() => setSubmitting(false));
  }

  function resetForm() {
    if (!form) return;
    const defaults: Record<string, any> = {};
    form.fields.forEach((f) => {
      if (f.type === "section" || f.type === "divider") return;
      if (f.type === "table") defaults[f.name] = f.defaultValue ?? [];
      else if (f.type === "checkbox" || f.type === "multiselect") defaults[f.name] = f.defaultValue ?? [];
      else defaults[f.name] = f.defaultValue ?? "";
    });
    setFormData(defaults);
    setFieldErrors({});
    setSubmitted(false);
    setStep(1);
    setAutoWorkflowId(null);
    setSubmitError(null);
  }

  /* ================================================================
     Render: loading
     ================================================================ */
  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in space-y-6">
        <div className="space-y-3">
          <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-8 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-96 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-10 w-full bg-gray-100 dark:bg-gray-800/60 rounded-lg animate-pulse" />
            </div>
          ))}
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {isNotFound ? "Form Not Found" : "Error Loading Form"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isNotFound ? "The form you are looking for does not exist or has been removed." : error}
          </p>
          <Link href="/forms" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors">
            <IconBack />Back to Forms
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Form Unavailable</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">This form is currently inactive and not accepting submissions.</p>
          <Link href="/forms" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors">
            <IconBack />Back to Forms
          </Link>
        </div>
      </div>
    );
  }

  /* ================================================================
     Render: success
     ================================================================ */
  if (submitted) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-5">
          <div className="flex justify-center"><IconSuccessBig /></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {autoWorkflowId ? "Request Submitted" : "Submission Successful"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {autoWorkflowId
              ? <><span className="font-medium text-gray-700 dark:text-gray-300">{form.name}</span> has been submitted and a workflow has been started. Track progress in your inbox.</>
              : <>Your response to <span className="font-medium text-gray-700 dark:text-gray-300">{form.name}</span> has been submitted successfully.</>
            }
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            {autoWorkflowId ? (
              <Link href="/workflows" className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors">
                View My Tasks
              </Link>
            ) : (
              <button onClick={resetForm} className="px-4 py-2 rounded-lg text-sm font-medium text-[#02773b] bg-[#02773b]/10 hover:bg-[#02773b]/20 transition-colors">
                Submit Another
              </button>
            )}
            <Link href="/forms" className="px-4 py-2 rounded-lg text-sm font-medium text-[#02773b] border border-[#02773b]/30 hover:bg-[#02773b]/5 transition-colors">
              Back to Forms
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
     Render: wizard
     ================================================================ */
  const totalRequired = form.fields.filter(
    (f) => f.required && isFieldVisible(f) && f.type !== "section" && f.type !== "divider"
  ).length;

  return (
    <div className="p-4 sm:p-6 animate-fade-in space-y-6">
      {/* ---- header ---- */}
      <div className="space-y-4">
        <Link href="/forms" className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-[#02773b] transition-colors">
          <IconBack />Back to Forms
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{form.name}</h1>
            {form.description && <p className="text-sm text-gray-500 dark:text-gray-400">{form.description}</p>}
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#dd9f42]/15 text-[#dd9f42] border border-[#dd9f42]/20">
            v{form.version}
          </span>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} />
      </div>

      {/* ====== STEP 1: Fill In ====== */}
      {step === 1 && (
        <form onSubmit={handleContinueToReview} noValidate>
          {totalRequired > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              <span className="text-red-500">*</span> indicates required fields
            </p>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6">
            <FormRenderer
              fields={form.fields}
              formData={formData}
              onChange={setField}
              errors={fieldErrors}
            />
          </div>

          {Object.keys(fieldErrors).length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
              Please fix {Object.keys(fieldErrors).length} error{Object.keys(fieldErrors).length > 1 ? "s" : ""} above before continuing.
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Link href="/forms" className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </Link>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors shadow-sm"
            >
              Review & Continue
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </form>
      )}

      {/* ====== STEP 2: Review & Submit ====== */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 text-sm text-blue-700 dark:text-blue-300">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>Please review your answers carefully. Click <strong>Edit answers</strong> to go back and make changes, or <strong>Submit</strong> to confirm.</span>
          </div>

          <ReviewPanel
            fields={form.fields}
            formData={formData}
            isVisible={isFieldVisible}
            onEdit={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          />

          {submitError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {submitting ? <><IconSpinner />Submitting…</> : <><IconCheck />Confirm & Submit</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
