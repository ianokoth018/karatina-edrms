"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import { DepartmentUserSelect, type UserOption } from "@/components/shared/department-user-select";
import { MultiUserInput } from "@/components/shared/multi-user-input";

const RichTextEditor = dynamic(() => import("@/components/memo/rich-text-editor"), { ssr: false });

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

interface DataSource {
  type: "departments" | "users" | "roles" | "casefolders" | "api";
  endpoint?: string;
  labelField?: string;
  valueField?: string;
  dependsOn?: string;
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
  excludeFields?: string[];
  maxUsers?: number;
  dataSource?: DataSource;
}

interface CasefolderData {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
}

interface WizardStep {
  label: string;
  description?: string;
  fields: FormField[];
}

/* ================================================================
   Step parsing
   ================================================================ */

function parseSteps(fields: FormField[]): WizardStep[] | null {
  const steps: WizardStep[] = [];
  let currentStep: WizardStep | null = null;

  for (const field of fields) {
    if (field.type === "step") {
      currentStep = { label: field.label, description: field.helpText, fields: [] };
      steps.push(currentStep);
    } else if (currentStep) {
      currentStep.fields.push(field);
    }
  }

  // If no steps found, return null (flat mode)
  if (steps.length === 0) return null;

  // Handle fields before first step marker
  const firstStepIdx = fields.findIndex((f) => f.type === "step");
  const preStepFields = fields.slice(0, firstStepIdx);
  if (preStepFields.length > 0) {
    steps.unshift({ label: "Details", fields: preStepFields });
  }

  // Add review step
  steps.push({ label: "Review & Submit", fields: [] });

  return steps;
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

function validateField(field: FormField, value: any): string | null {
  if (field.type === "section" || field.type === "divider" || field.type === "step") return null;

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

function IconChevronRight() {
  return (
    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconFilePlus() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
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

function IconWarning() {
  return (
    <svg className="w-16 h-16 text-[#dd9f42]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
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
   File upload drag-drop zone (visual only)
   ================================================================ */

function FileDropZone({
  files,
  onAdd,
  onRemove,
}: {
  files: File[];
  onAdd: (f: File[]) => void;
  onRemove: (idx: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) onAdd(dropped);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) onAdd(selected);
    e.target.value = "";
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-[#02773b] bg-[#02773b]/5 dark:bg-[#02773b]/10"
            : "border-gray-300 dark:border-gray-700 hover:border-[#02773b]/50 bg-gray-50 dark:bg-gray-900/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInput}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="text-gray-400 dark:text-gray-500">
            <IconUpload />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-[#02773b]">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            PDF, DOCX, XLSX, images, or any document format
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <div className="text-gray-400 dark:text-gray-500">
                <IconPaperclip />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {file.name}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {formatSize(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                title="Remove file"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Dynamic data source fetching
   ================================================================ */

function useDynamicOptions(
  fields: FormField[],
  fieldValues: Record<string, any>
) {
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, FormFieldOption[]>>({});
  const [loadingFields, setLoadingFields] = useState<Record<string, boolean>>({});

  // Collect all fields with data sources
  const dsFields = fields.filter((f) => f.dataSource);

  useEffect(() => {
    dsFields.forEach((field) => {
      const ds = field.dataSource!;

      // For "users" type, wait until the dependent field has a value
      if (ds.type === "users" && ds.dependsOn) {
        const depValue = fieldValues[ds.dependsOn];
        if (!depValue) {
          // Clear options when dependency is cleared
          setDynamicOptions((prev) => {
            if (prev[field.name]?.length) return { ...prev, [field.name]: [] };
            return prev;
          });
          return;
        }
      }

      // Build the fetch URL
      let url = "";
      switch (ds.type) {
        case "departments":
          url = "/api/users/search?departments=true";
          break;
        case "users": {
          const dept = ds.dependsOn ? fieldValues[ds.dependsOn] : "";
          if (!dept) return;
          url = `/api/users/search?department=${encodeURIComponent(dept)}&limit=50`;
          break;
        }
        case "roles":
          url = "/api/users/search?roles=true";
          break;
        case "casefolders":
          url = "/api/records/casefolders";
          break;
        case "api":
          if (!ds.endpoint) return;
          url = ds.endpoint;
          break;
        default:
          return;
      }

      setLoadingFields((prev) => ({ ...prev, [field.name]: true }));

      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          let items: any[] = [];
          const labelKey = ds.labelField || "name";
          const valueKey = ds.valueField || "name";

          switch (ds.type) {
            case "departments":
              items = data.departments ?? [];
              break;
            case "users":
              items = data.users ?? [];
              break;
            case "roles":
              items = data.roles ?? [];
              break;
            case "casefolders":
              items = data.casefolders ?? [];
              break;
            case "api":
              items = Array.isArray(data) ? data : data.items ?? data.data ?? data.options ?? [];
              break;
          }

          const options: FormFieldOption[] = items.map((item: any) => ({
            label: String(item[labelKey] ?? item.displayName ?? item.name ?? ""),
            value: String(item[valueKey] ?? item.id ?? item.name ?? ""),
          }));

          setDynamicOptions((prev) => ({ ...prev, [field.name]: options }));
        })
        .catch(() => {
          setDynamicOptions((prev) => ({ ...prev, [field.name]: [] }));
        })
        .finally(() => {
          setLoadingFields((prev) => ({ ...prev, [field.name]: false }));
        });
    });
    // Re-fetch when dependency values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Trigger re-fetch when any dependency field value changes
    ...dsFields
      .filter((f) => f.dataSource?.dependsOn)
      .map((f) => fieldValues[f.dataSource!.dependsOn!]),
    // Also trigger on initial load
    fields.length,
  ]);

  return { dynamicOptions, loadingFields };
}

/* ================================================================
   Main page component
   ================================================================ */

export default function FileDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();

  /* ----- state ----- */
  const [casefolder, setCasefolder] = useState<CasefolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* field values for the casefolder metadata fields */
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /* document details */
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  /* file attachments (visual only) */
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  /* submission state */
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* document-level field errors */
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});

  /* wizard state */
  const [wizardSteps, setWizardSteps] = useState<WizardStep[] | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  /* dynamic data source options */
  const { dynamicOptions, loadingFields } = useDynamicOptions(
    casefolder?.fields ?? [],
    fieldValues
  );

  /* ----- fetch casefolder definition ----- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/forms/${id}`)
      .then((res) => {
        if (!res.ok)
          throw new Error(
            res.status === 404 ? "CASEFOLDER_NOT_FOUND" : `Failed to load casefolder (${res.status})`
          );
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const cf: CasefolderData = {
          id: data.id,
          name: data.name,
          description: data.description,
          fields: Array.isArray(data.fields) ? data.fields : [],
        };
        setCasefolder(cf);

        /* detect wizard mode */
        const steps = parseSteps(cf.fields);
        setWizardSteps(steps);

        /* initialise field values with defaults + auto-fill from session */
        const defaults: Record<string, any> = {};
        cf.fields.forEach((f) => {
          if (f.type === "section" || f.type === "divider" || f.type === "step") return;
          if (f.type === "table") {
            defaults[f.name] = f.defaultValue ?? [];
          } else if (f.type === "checkbox" || f.type === "multiselect") {
            defaults[f.name] = f.defaultValue ?? [];
          } else if (f.type === "user_picker") {
            defaults[f.name] = f.defaultValue ?? "";
          } else if (f.type === "multi_user_picker") {
            defaults[f.name] = f.defaultValue ?? "[]";
          } else {
            defaults[f.name] = f.defaultValue ?? "";
          }

          // Auto-fill casefolder-level fields from session profile
          if ((f as any).fieldLevel === "casefolder" && session?.user) {
            const nameL = f.name.toLowerCase();
            const labelL = (f.label ?? "").toLowerCase();
            if (nameL.includes("from") || labelL.includes("from")) {
              defaults[f.name] = session.user.name ?? "";
            } else if (nameL.includes("designation") || labelL.includes("designation")) {
              defaults[f.name] = (session.user as any).jobTitle ?? "";
            } else if (nameL.includes("department_office") || labelL.includes("department office") || labelL.includes("office")) {
              const dept = (session.user as any).department ?? "";
              defaults[f.name] = dept ? `OFFICE OF THE ${dept.toUpperCase()}` : "";
            } else if (nameL.includes("phone") || labelL.includes("phone")) {
              defaults[f.name] = "+254 0716135171/0723683150";
            } else if (nameL.includes("po_box") || nameL.includes("pobox") || labelL.includes("p.o")) {
              defaults[f.name] = "P.O Box 1957-10101,KARATINA";
            }
          }
        });
        setFieldValues(defaults);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ----- helpers ----- */
  const setField = useCallback((name: string, value: any) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
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
    return evaluateCondition(field.condition, fieldValues, casefolder?.fields ?? []);
  }

  /* ----- excludeIds helper for user pickers ----- */
  function getExcludeIds(field: FormField): string[] {
    const ids: string[] = [session?.user?.id].filter(Boolean) as string[];
    if (field.excludeFields) {
      for (const otherFieldId of field.excludeFields) {
        const otherField = casefolder?.fields.find((f: FormField) => f.id === otherFieldId);
        if (otherField) {
          const val = fieldValues[otherField.name];
          if (val) {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) {
                ids.push(...parsed.map((u: UserOption) => u.id));
              } else if (parsed.id) {
                ids.push(parsed.id);
              }
            } catch {
              /* not JSON, skip */
            }
          }
        }
      }
    }
    return ids;
  }

  /* ----- auto-suggest title from field values ----- */
  const suggestedTitle = (() => {
    if (!casefolder) return "";
    const parts: string[] = [];
    casefolder.fields.forEach((f) => {
      if (f.type === "section" || f.type === "divider" || f.type === "table" || f.type === "file" || f.type === "step" || f.type === "user_picker" || f.type === "multi_user_picker") return;
      if (!isFieldVisible(f)) return;
      const val = fieldValues[f.name];
      if (val && typeof val === "string" && val.trim()) {
        parts.push(val.trim());
      }
    });
    return parts.slice(0, 3).join(" - ");
  })();

  /* auto-fill title if user has not manually edited it */
  useEffect(() => {
    if (!titleTouched && suggestedTitle) {
      setTitle(suggestedTitle);
    }
  }, [suggestedTitle, titleTouched]);

  /* ----- validate a set of fields ----- */
  function validateFields(fields: FormField[]): Record<string, string> {
    const fErrors: Record<string, string> = {};
    fields.forEach((field) => {
      if (!isFieldVisible(field)) return;
      const err = validateField(field, fieldValues[field.name]);
      if (err) fErrors[field.name] = err;
    });
    return fErrors;
  }

  /* ----- wizard step validation ----- */
  function validateCurrentStep(): boolean {
    if (!wizardSteps) return true;
    const step = wizardSteps[currentStep];
    if (!step || step.fields.length === 0) return true; // review step

    const fErrors = validateFields(step.fields);
    if (Object.keys(fErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...fErrors }));
      const firstFieldKey = Object.keys(fErrors)[0];
      if (firstFieldKey) {
        const el = document.querySelector(`[data-field="${firstFieldKey}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    return true;
  }

  function handleNextStep() {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(prev + 1, (wizardSteps?.length ?? 1) - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handlePrevStep() {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToStep(stepIdx: number) {
    setCurrentStep(stepIdx);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ----- submit ----- */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!casefolder) return;

    /* validate casefolder metadata fields */
    const allFields = casefolder.fields.filter((f) => f.type !== "step");
    const fErrors = validateFields(allFields);

    if (Object.keys(fErrors).length > 0) {
      setFieldErrors(fErrors);
      setDocErrors({});

      /* If in wizard mode, jump to the first step with errors */
      if (wizardSteps) {
        for (let i = 0; i < wizardSteps.length; i++) {
          const stepFields = wizardSteps[i].fields;
          const hasError = stepFields.some((f) => fErrors[f.name]);
          if (hasError) {
            setCurrentStep(i);
            setTimeout(() => {
              const firstFieldKey = stepFields.find((f) => fErrors[f.name])?.name;
              if (firstFieldKey) {
                const el = document.querySelector(`[data-field="${firstFieldKey}"]`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 100);
            return;
          }
        }
      } else {
        /* scroll to first error */
        const firstFieldKey = Object.keys(fErrors)[0];
        if (firstFieldKey) {
          const el = document.querySelector(`[data-field="${firstFieldKey}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }

    setFieldErrors({});
    setDocErrors({});
    setSubmitting(true);
    setSubmitError(null);

    /* collect only visible field values */
    const payload: Record<string, any> = {};
    casefolder.fields.forEach((field) => {
      if (field.type === "section" || field.type === "divider" || field.type === "step") return;
      if (!isFieldVisible(field)) return;
      payload[field.name] = fieldValues[field.name];
    });

    /* Auto-derive title from fields marked usedInTitle */
    const titleFields = casefolder.fields.filter((f: any) => f.usedInTitle);
    const autoTitle = titleFields.length > 0
      ? titleFields.map((f: any) => fieldValues[f.name]).filter(Boolean).join(" — ")
      : Object.values(payload).filter((v) => typeof v === "string" && v.trim()).slice(0, 3).join(" — ");

    /* Auto-derive department from casefolder fields */
    const deptField = casefolder.fields.find((f: any) => f.name === "department" || f.name === "school" || (f.label as string)?.toLowerCase().includes("department"));
    const autoDept = deptField ? String(fieldValues[deptField.name] ?? "") : "";

    fetch(`/api/records/casefolders/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: autoTitle || casefolder.name,
        department: autoDept || casefolder.name,
        fieldValues: payload,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Filing failed (${res.status})`);
        }
        return res.json();
      })
      .then((doc) => {
        router.push(`/records/casefolders/${id}/${doc.id}`);
      })
      .catch((err) => {
        setSubmitError(err.message);
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  /* ================================================================
     Render: loading skeleton
     ================================================================ */
  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* skeleton breadcrumb */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          </div>
          {/* skeleton header */}
          <div className="space-y-2">
            <div className="h-8 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-96 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          </div>
          {/* skeleton card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800/60 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
          {/* skeleton card 2 */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-28 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800/60 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
     Render: error / not found
     ================================================================ */
  if (error || !casefolder) {
    const isNotFound = error === "CASEFOLDER_NOT_FOUND";
    return (
      <div className="p-4 sm:p-6 animate-fade-in">
        <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <div className="flex justify-center">
            <IconWarning />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {isNotFound ? "Casefolder Not Found" : "Error Loading Casefolder"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isNotFound
              ? "The casefolder you are looking for does not exist or has been removed."
              : error}
          </p>
          <Link
            href="/records/casefolders"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors"
          >
            <IconBack />
            Back to Casefolders
          </Link>
        </div>
      </div>
    );
  }

  /* ================================================================
     Field renderer (same as form fill page, plus user pickers)
     ================================================================ */
  function renderField(field: FormField) {
    if (!isFieldVisible(field)) return null;

    const err = fieldErrors[field.name];
    const val = fieldValues[field.name];

    // Resolve options: dynamic data source takes priority over static
    const resolvedOptions = field.dataSource
      ? (dynamicOptions[field.name] ?? [])
      : (field.options ?? []);
    const isLoadingOptions = !!loadingFields[field.name];

    /* --- step marker (skip rendering) --- */
    if (field.type === "step") return null;

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
        {field.type !== "user_picker" && field.type !== "multi_user_picker" && (
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}

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

        {/* --- richtext (TipTap editor) --- */}
        {field.type === "richtext" && (
          <div className="[&_.ProseMirror]:min-h-[300px]">
            <RichTextEditor
              content={(val as string) ?? ""}
              onChange={(html) => setField(field.name, html)}
              placeholder={field.placeholder || "Type your content here..."}
            />
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
          isLoadingOptions ? (
            <div className={`${inputCls(false)} flex items-center gap-2 text-gray-400`}>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs">Loading options...</span>
            </div>
          ) : (
            <select
              value={val ?? ""}
              onChange={(e) => setField(field.name, e.target.value)}
              disabled={field.readOnly}
              className={inputCls(!!err)}
            >
              <option value="">{field.placeholder || "Select an option..."}</option>
              {resolvedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )
        )}

        {/* --- multiselect --- */}
        {field.type === "multiselect" && (
          <MultiSelectField
            field={{ ...field, options: resolvedOptions }}
            value={Array.isArray(val) ? val : []}
            onChange={(v) => setField(field.name, v)}
            hasError={!!err}
          />
        )}

        {/* --- radio --- */}
        {field.type === "radio" && (
          <div className="space-y-2 pt-1">
            {isLoadingOptions ? (
              <div className="flex items-center gap-2 text-gray-400 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">Loading options...</span>
              </div>
            ) : (
              resolvedOptions.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`cf-${field.name}`}
                    value={opt.value}
                    checked={val === opt.value}
                    onChange={() => setField(field.name, opt.value)}
                    disabled={field.readOnly}
                    className="text-[#02773b] focus:ring-[#02773b]/40 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        )}

        {/* --- checkbox group --- */}
        {field.type === "checkbox" && (
          <div className="space-y-2 pt-1">
            {isLoadingOptions ? (
              <div className="flex items-center gap-2 text-gray-400 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">Loading options...</span>
              </div>
            ) : (
              resolvedOptions.map((opt) => {
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
              })
            )}
          </div>
        )}

        {/* --- table --- */}
        {field.type === "table" && (
          <TableField
            field={field}
            value={Array.isArray(val) ? val : []}
            onChange={(rows) => setField(field.name, rows)}
          />
        )}

        {/* --- user_picker --- */}
        {field.type === "user_picker" && (
          <DepartmentUserSelect
            label={field.label}
            selectedUser={val ? (() => { try { return JSON.parse(val); } catch { return null; } })() : null}
            onSelect={(user) => setField(field.name, user ? JSON.stringify(user) : "")}
            onClear={() => setField(field.name, "")}
            excludeIds={getExcludeIds(field)}
            sublabel={field.helpText}
          />
        )}

        {/* --- multi_user_picker --- */}
        {field.type === "multi_user_picker" && (() => {
          let users: UserOption[] = [];
          try { users = val ? JSON.parse(val) : []; } catch { users = []; }
          return (
            <MultiUserInput
              label={field.label}
              sublabel={field.helpText}
              users={users}
              onAdd={(user) => {
                let current: UserOption[] = [];
                try { current = val ? JSON.parse(val) : []; } catch { current = []; }
                if (current.length < (field.maxUsers || 5)) {
                  setField(field.name, JSON.stringify([...current, user]));
                }
              }}
              onRemove={(userId) => {
                let current: UserOption[] = [];
                try { current = val ? JSON.parse(val) : []; } catch { current = []; }
                setField(field.name, JSON.stringify(current.filter((u: UserOption) => u.id !== userId)));
              }}
              excludeIds={getExcludeIds(field)}
              max={field.maxUsers || 5}
            />
          );
        })()}

        {/* help text (skip for user pickers which show sublabel internally) */}
        {field.helpText && field.type !== "user_picker" && field.type !== "multi_user_picker" && (
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
     Inline error helper for doc-level fields
     ================================================================ */
  function InlineError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return (
      <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1 mt-1">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
        {msg}
      </p>
    );
  }

  /* ================================================================
     Review step renderer
     ================================================================ */
  function renderReviewStep() {
    if (!wizardSteps || !casefolder) return null;

    // All steps except the review step
    const contentSteps = wizardSteps.slice(0, -1);

    return (
      <div className="space-y-6 animate-slide-up">
        {contentSteps.map((step, stepIdx) => {
          const visibleFields = step.fields.filter(
            (f) => f.type !== "section" && f.type !== "divider" && f.type !== "step" && isFieldVisible(f)
          );
          if (visibleFields.length === 0) return null;

          return (
            <div
              key={stepIdx}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {step.label}
                </h3>
                <button
                  type="button"
                  onClick={() => goToStep(stepIdx)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
                >
                  <IconEdit />
                  Edit
                </button>
              </div>
              <div className="p-5 space-y-3">
                {visibleFields.map((field) => {
                  const val = fieldValues[field.name];
                  return (
                    <div key={field.id} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 sm:w-40 flex-shrink-0">
                        {field.label}
                      </span>
                      <div className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-0">
                        {renderReviewValue(field, val)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderReviewValue(field: FormField, val: any) {
    if (val == null || val === "" || val === "[]") {
      return <span className="text-gray-400 dark:text-gray-500 italic">Not provided</span>;
    }

    switch (field.type) {
      case "user_picker": {
        try {
          const user: UserOption = JSON.parse(val);
          return (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#02773b]/10 flex items-center justify-center text-[#02773b] text-[10px] font-semibold flex-shrink-0">
                {user.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
              </div>
              <div>
                <span className="font-medium">{user.displayName}</span>
                {(user.jobTitle || user.department) && (
                  <span className="text-xs text-gray-500 ml-1">
                    ({[user.jobTitle, user.department].filter(Boolean).join(", ")})
                  </span>
                )}
              </div>
            </div>
          );
        } catch {
          return <span>{String(val)}</span>;
        }
      }

      case "multi_user_picker": {
        try {
          const users: UserOption[] = JSON.parse(val);
          if (users.length === 0) return <span className="text-gray-400 italic">None selected</span>;
          return (
            <div className="space-y-1">
              {users.map((user, idx) => (
                <div key={user.id} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#02773b]/10 text-[#02773b] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span className="font-medium">{user.displayName}</span>
                  {(user.jobTitle || user.department) && (
                    <span className="text-xs text-gray-500">
                      ({[user.jobTitle, user.department].filter(Boolean).join(", ")})
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        } catch {
          return <span>{String(val)}</span>;
        }
      }

      case "richtext":
        return (
          <div
            className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
            dangerouslySetInnerHTML={{ __html: val }}
          />
        );

      case "table": {
        const rows = Array.isArray(val) ? val : [];
        if (rows.length === 0) return <span className="text-gray-400 italic">No rows</span>;
        const columns = field.tableColumns ?? [];
        return (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60">
                  {columns.map((col) => (
                    <th key={col.name} className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-400">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((row: Record<string, any>, rIdx: number) => (
                  <tr key={rIdx}>
                    {columns.map((col) => (
                      <td key={col.name} className="px-2 py-1.5 text-gray-900 dark:text-gray-100">
                        {row[col.name] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case "checkbox":
      case "multiselect": {
        const arr = Array.isArray(val) ? val : [];
        if (arr.length === 0) return <span className="text-gray-400 italic">None selected</span>;
        const allOpts = field.dataSource ? (dynamicOptions[field.name] ?? []) : (field.options ?? []);
        const optionLabels = allOpts
          .filter((o) => arr.includes(o.value))
          .map((o) => o.label);
        return <span>{optionLabels.length ? optionLabels.join(", ") : arr.join(", ")}</span>;
      }

      case "select": {
        const allOpts = field.dataSource ? (dynamicOptions[field.name] ?? []) : (field.options ?? []);
        const opt = allOpts.find((o) => o.value === val);
        return <span>{opt?.label ?? val}</span>;
      }

      case "radio": {
        const allOpts = field.dataSource ? (dynamicOptions[field.name] ?? []) : (field.options ?? []);
        const opt = allOpts.find((o) => o.value === val);
        return <span>{opt?.label ?? val}</span>;
      }

      case "file":
        return <span>{String(val)}</span>;

      default:
        return <span>{String(val)}</span>;
    }
  }

  /* ================================================================
     Render: form
     ================================================================ */
  const hasMetadataFields = casefolder.fields.some(
    (f) => f.type !== "section" && f.type !== "divider" && f.type !== "step" && isFieldVisible(f)
  );

  const totalRequired = casefolder.fields.filter(
    (f) => f.required && isFieldVisible(f) && f.type !== "section" && f.type !== "divider" && f.type !== "step"
  ).length;

  const isWizardMode = wizardSteps !== null;
  const isReviewStep = isWizardMode && currentStep === wizardSteps!.length - 1;

  return (
    <div className="p-4 sm:p-6 animate-fade-in">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* ---- breadcrumb ---- */}
        <nav className="flex items-center gap-1.5 text-sm flex-wrap">
          <Link
            href="/records"
            className="text-gray-500 dark:text-gray-400 hover:text-[#02773b] transition-colors"
          >
            Records
          </Link>
          <IconChevronRight />
          <Link
            href="/records/casefolders"
            className="text-gray-500 dark:text-gray-400 hover:text-[#02773b] transition-colors"
          >
            Casefolders
          </Link>
          <IconChevronRight />
          <Link
            href={`/records/casefolders/${id}`}
            className="text-gray-500 dark:text-gray-400 hover:text-[#02773b] transition-colors"
          >
            {casefolder.name}
          </Link>
          <IconChevronRight />
          <span className="text-gray-900 dark:text-gray-100 font-medium">
            File New Document
          </span>
        </nav>

        {/* ---- header ---- */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#02773b]/10">
              <div className="text-[#02773b]">
                <IconFilePlus />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                File New Document
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Filing into <span className="font-medium text-[#dd9f42]">{casefolder.name}</span>
              </p>
            </div>
          </div>

          {(totalRequired > 0) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span className="text-red-500">*</span> indicates required fields
            </p>
          )}
        </div>

        {/* ================================================================
           WIZARD MODE: Step indicator + step content
           ================================================================ */}
        {isWizardMode && (
          <>
            {/* Step indicator */}
            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
              {wizardSteps!.map((s, idx) => (
                <div key={idx} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (idx < currentStep) goToStep(idx);
                    }}
                    disabled={idx > currentStep}
                    className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                      idx === currentStep
                        ? "bg-[#02773b] text-white shadow-md shadow-[#02773b]/20"
                        : idx < currentStep
                        ? "bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 cursor-pointer hover:bg-[#02773b]/20"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === currentStep
                          ? "bg-white/20 text-white"
                          : idx < currentStep
                          ? "bg-[#02773b] text-white"
                          : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {idx < currentStep ? <IconCheck /> : idx + 1}
                    </span>
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {idx < wizardSteps!.length - 1 && (
                    <div
                      className={`w-4 sm:w-8 h-0.5 flex-shrink-0 ${
                        idx < currentStep
                          ? "bg-[#02773b]"
                          : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Step content */}
            <form onSubmit={handleSubmit} noValidate>
              {/* Regular step: show fields */}
              {!isReviewStep && (
                <div className="space-y-5 animate-slide-up">
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6">
                    {/* Step header */}
                    <div className="mb-5">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {wizardSteps![currentStep].label}
                      </h2>
                      {wizardSteps![currentStep].description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {wizardSteps![currentStep].description}
                        </p>
                      )}
                    </div>

                    {/* Fields for current step */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                      {wizardSteps![currentStep].fields.map((field) => renderField(field))}
                    </div>
                  </div>

                  {/* submit error banner */}
                  {submitError && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      {submitError}
                    </div>
                  )}

                  {/* validation summary */}
                  {Object.keys(fieldErrors).length > 0 && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
                      Please fix the errors above before continuing.
                    </div>
                  )}

                  {/* Navigation */}
                  <div className="flex items-center justify-between gap-3">
                    {currentStep > 0 ? (
                      <button
                        type="button"
                        onClick={handlePrevStep}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        <IconBack />
                        Back
                      </button>
                    ) : (
                      <Link
                        href={`/records/casefolders/${id}`}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] transition-colors shadow-sm"
                    >
                      Next
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Review step */}
              {isReviewStep && (
                <div className="space-y-5 animate-slide-up">
                  {renderReviewStep()}

                  {/* submit error banner */}
                  {submitError && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      {submitError}
                    </div>
                  )}

                  {/* Navigation */}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={handlePrevStep}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      <IconBack />
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#02773b] hover:bg-[#026332] disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                      {submitting ? (
                        <>
                          <IconSpinner />
                          Filing...
                        </>
                      ) : (
                        <>
                          <IconFilePlus />
                          File Document
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </>
        )}

        {/* ================================================================
           FLAT MODE: Original layout (no step fields detected)
           ================================================================ */}
        {!isWizardMode && (
          <form onSubmit={handleSubmit} noValidate>

            {/* ---- Section 1: Casefolder-level fields (shared across all docs) ---- */}
            {casefolder.fields.some((f) => (f as any).fieldLevel !== "document") && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#02773b]" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                    Casefolder Fields
                  </h2>
                  <span className="text-[10px] text-gray-400 font-normal normal-case">-- shared across all documents</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                  {casefolder.fields.filter((f) => (f as any).fieldLevel !== "document").map((field) => renderField(field))}
                </div>
              </div>
            )}

            {/* ---- Section 2: Document details ---- */}
            <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 ${hasMetadataFields ? "mt-5" : ""}`}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                    Document Details
                  </h2>
                  <span className="text-[10px] text-gray-400 font-normal normal-case">-- specific to this document</span>
                </div>
              </div>

              <div className="space-y-4">
                {/* Document-level casefolder fields (e.g., Document Description, Folio Number) */}
                {casefolder.fields.some((f) => (f as any).fieldLevel === "document") && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5 mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
                    {casefolder.fields.filter((f) => (f as any).fieldLevel === "document").map((field) => renderField(field))}
                  </div>
                )}

                {/* Title and department are auto-derived from casefolder fields marked as usedInTitle/fieldLevel */}
              </div>
            </div>

            {/* ---- Section 3: File attachments (visual only) ---- */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 mt-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-1 w-1 rounded-full bg-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide">
                  Attachments
                </h2>
                <span className="text-xs text-gray-400 dark:text-gray-500 font-normal normal-case">(optional, can also attach after filing)</span>
              </div>
              <FileDropZone
                files={attachedFiles}
                onAdd={(newFiles) => setAttachedFiles((prev) => [...prev, ...newFiles])}
                onRemove={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
              />
            </div>

            {/* ---- submit error banner ---- */}
            {submitError && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {submitError}
              </div>
            )}

            {/* ---- validation summary ---- */}
            {(Object.keys(fieldErrors).length > 0 || Object.keys(docErrors).length > 0) && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-600 dark:text-red-400">
                Please fix {Object.keys(fieldErrors).length + Object.keys(docErrors).length} error
                {Object.keys(fieldErrors).length + Object.keys(docErrors).length > 1 ? "s" : ""} above
                before filing.
              </div>
            )}

            {/* ---- actions ---- */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <Link
                href={`/records/casefolders/${id}`}
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
                    Filing...
                  </>
                ) : (
                  <>
                    <IconFilePlus />
                    File Document
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
