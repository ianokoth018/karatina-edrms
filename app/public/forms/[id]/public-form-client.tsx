"use client";

import { useCallback, useState } from "react";
import {
  FormRenderer,
  FormField,
  evaluateCondition,
} from "@/components/forms/form-renderer";

interface Props {
  formId: string;
  formName: string;
  formDescription: string | null;
  fields: FormField[];
}

function validateField(field: FormField, value: unknown): string | null {
  if (field.type === "section" || field.type === "divider") return null;
  const strVal = value == null ? "" : String(value);
  if (field.required && strVal.trim() === "")
    return `${field.label} is required`;
  if (!strVal) return null;
  if (field.validation) {
    const v = field.validation;
    if (field.type === "number" || field.type === "table") {
      const num = Number(value);
      if (v.min != null && num < v.min) return `Minimum value is ${v.min}`;
      if (v.max != null && num > v.max) return `Maximum value is ${v.max}`;
    }
    if (v.minLength != null && strVal.length < v.minLength)
      return `Minimum ${v.minLength} characters required`;
    if (v.maxLength != null && strVal.length > v.maxLength)
      return `Maximum ${v.maxLength} characters allowed`;
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern).test(strVal))
          return v.patternMessage ?? "Invalid format";
      } catch {
        /* ignore */
      }
    }
  }
  if (
    field.type === "email" &&
    strVal &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)
  )
    return "Please enter a valid email address";
  return null;
}

export default function PublicFormClient({
  formId,
  formName,
  formDescription,
  fields,
}: Props) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    fields.forEach((f) => {
      if (f.type === "section" || f.type === "divider") return;
      if (f.type === "table") defaults[f.name] = f.defaultValue ?? [];
      else if (f.type === "checkbox" || f.type === "multiselect")
        defaults[f.name] = f.defaultValue ?? [];
      else defaults[f.name] = f.defaultValue ?? "";
    });
    return defaults;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setField = useCallback((name: string, value: unknown) => {
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
    return evaluateCondition(field.condition, formData, fields);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const errors: Record<string, string> = {};
    fields.forEach((field) => {
      if (!isFieldVisible(field)) return;
      const err = validateField(field, formData[field.name]);
      if (err) errors[field.name] = err;
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const payload: Record<string, unknown> = {};
    fields.forEach((field) => {
      if (field.type === "section" || field.type === "divider") return;
      if (!isFieldVisible(field)) return;
      payload[field.name] = formData[field.name];
    });

    setSubmitting(true);
    fetch(`/api/public/forms/${formId}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ??
              `Submission failed (${res.status})`,
          );
        }
        setSubmitted(true);
      })
      .catch((err: Error) => setSubmitError(err.message))
      .finally(() => setSubmitting(false));
  }

  if (submitted) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="flex justify-center">
          <svg
            className="w-16 h-16 text-[#02773b]"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Thank you
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Your response to{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {formName}
          </span>{" "}
          has been received.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formName}
        </h1>
        {formDescription && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formDescription}
          </p>
        )}
      </div>

      <FormRenderer
        fields={fields}
        formData={formData}
        onChange={setField}
        errors={fieldErrors}
      />

      {Object.keys(fieldErrors).length > 0 && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
          Please fix the highlighted error
          {Object.keys(fieldErrors).length > 1 ? "s" : ""} before submitting.
        </div>
      )}

      {submitError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
          {submitError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
