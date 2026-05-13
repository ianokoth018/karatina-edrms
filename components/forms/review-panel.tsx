"use client";

import { useState, useEffect } from "react";
import type { FormField } from "./form-renderer";

interface ReviewPanelProps {
  fields: FormField[];
  formData: Record<string, unknown>;
  isVisible: (f: FormField) => boolean;
  onEdit: () => void;
  readOnly?: boolean;
}

/**
 * ReviewPanel — displays a read-only summary of form answers before submission.
 *
 * Resolves human-readable labels for:
 *   - radio / select   → option label instead of option value
 *   - multiselect / checkbox (multi) → comma-separated option labels
 *   - user_picker / multi_user_picker → user display names (fetched from API)
 *   - checkbox (boolean) → "Yes" / "No"
 *   - checkbox (string slug) → sentence-cased readable text
 *   - date → "18 May 2026"
 *   - file → file name
 */
export function ReviewPanel({ fields, formData, isVisible, onEdit, readOnly = false }: ReviewPanelProps) {
  // Resolved display names for user IDs: { userId → displayName }
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = new Set<string>();
    for (const f of fields) {
      if (f.type === "user_picker") {
        const v = formData[f.name];
        if (v && typeof v === "string") ids.add(v);
      }
      if (f.type === "multi_user_picker") {
        const arr = formData[f.name];
        if (Array.isArray(arr)) arr.forEach((id) => typeof id === "string" && ids.add(id));
      }
    }
    if (ids.size === 0) return;

    (async () => {
      try {
        const res = await fetch(`/api/users/search?ids=${[...ids].join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const u of data.users ?? []) {
          map[u.id] = u.displayName ?? u.name ?? u.email ?? u.id;
        }
        setUserNames(map);
      } catch { /* silent */ }
    })();
  }, [fields, formData]);

  function formatValue(field: FormField, value: unknown): string {
    if (value == null || value === "") return "—";

    // ── Radio / Select → look up label from static options ──
    if ((field.type === "radio" || field.type === "select") && field.options?.length) {
      if (typeof value === "string") {
        const opt = field.options.find((o) => o.value === value);
        if (opt) return opt.label;
      }
    }

    // ── Multiselect / Checkbox with options (array) → map to labels ──
    if ((field.type === "multiselect" || field.type === "checkbox") && field.options?.length) {
      if (Array.isArray(value)) {
        if (value.length === 0) return "—";
        return value
          .map((v) => {
            const opt = field.options!.find((o) => o.value === v);
            return opt?.label ?? String(v);
          })
          .join(", ");
      }
    }

    // ── Checkbox (simple boolean) ──
    if (field.type === "checkbox" && typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    // ── Checkbox (string slug — declaration-style) ──
    // e.g. "i_confirm_that_the_information_provided_above_is_true_and_accurate"
    if (field.type === "checkbox" && typeof value === "string") {
      return value
        .replace(/[_\-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // ── User picker → resolved display name ──
    if (field.type === "user_picker" && typeof value === "string") {
      return userNames[value] ?? value;
    }

    // ── Multi-user picker → list of display names ──
    if (field.type === "multi_user_picker" && Array.isArray(value)) {
      if (value.length === 0) return "—";
      return value.map((id) => (typeof id === "string" ? (userNames[id] ?? id) : String(id))).join(", ");
    }

    // ── Date → human-readable ──
    if ((field.type === "date" || field.type === "datetime") && typeof value === "string") {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          ...(field.type === "datetime" ? { hour: "2-digit", minute: "2-digit" } : {}),
        });
      }
    }

    // ── File ──
    if (field.type === "file" && value instanceof File) return value.name;
    if (field.type === "file" && typeof value === "string") return value;

    // ── Array fallback ──
    if (Array.isArray(value)) {
      return value.length ? value.map(String).join(", ") : "—";
    }

    return String(value);
  }

  // Group fields into sections
  type Section = { title: string | null; fields: FormField[] };
  const sections: Section[] = [];
  let current: Section = { title: null, fields: [] };

  for (const f of fields) {
    if (f.type === "divider" || f.type === "step") continue;
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
        <div
          key={si}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          {sec.title && (
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {sec.title}
              </h3>
            </div>
          )}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {sec.fields.map((f) => {
              const display = formatValue(f, formData[f.name]);
              const empty = display === "—";
              return (
                <div key={f.name} className="grid grid-cols-1 sm:grid-cols-2 gap-1 px-5 py-3">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide self-center">
                    {f.label}
                    {f.required && <span className="text-red-400 ml-0.5">*</span>}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      empty
                        ? "text-gray-400 dark:text-gray-600 italic"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {display}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly && (
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
      )}
    </div>
  );
}
