"use client";

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormRenderer } from "@/components/forms/form-renderer";
import type { FormField as RendererFormField } from "@/components/forms/form-renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormField {
  id: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "email"
    | "phone"
    | "date"
    | "datetime"
    | "select"
    | "multiselect"
    | "radio"
    | "checkbox"
    | "file"
    | "section"
    | "divider"
    | "richtext"
    | "table"
    | "step"
    | "user_picker"
    | "multi_user_picker";
  label: string;
  name: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  defaultValue?: any;
  width?: "full" | "half";
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    patternMessage?: string;
    crossFieldRules?: { compareTo: string; operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq"; message: string }[];
    minDate?: string;
    maxDate?: string;
  };
  options?: { label: string; value: string }[];
  condition?: {
    fieldId: string;
    operator: "equals" | "not_equals" | "contains" | "not_empty" | "empty";
    value?: string;
  };
  tableColumns?: { label: string; name: string; type: string }[];
  // Dynamic data source for select/multiselect/radio/checkbox
  dataSource?: {
    type: "departments" | "users" | "roles" | "casefolders" | "api";
    endpoint?: string;           // Custom API endpoint (for type "api")
    labelField?: string;         // Field from response to use as label (default: "name")
    valueField?: string;         // Field from response to use as value (default: "name")
    dependsOn?: string;          // Field name this depends on (e.g., department select for user list)
    filterByMyDepartment?: boolean; // Pre-filter users to the submitter's own department
  };
  // For user_picker and multi_user_picker
  maxUsers?: number;           // Max users for multi_user_picker (default 5)
  orderable?: boolean;         // Whether users can be reordered (multi_user_picker)
  excludeFields?: string[];    // IDs of other user picker fields whose selected values should be excluded
  /** When true, skip the dept dropdown and show only colleagues from the submitter's own department. */
  filterByMyDepartment?: boolean;
  // For step
  stepIcon?: string;           // Optional icon name for the step
  includeReviewStep?: boolean; // If true, auto-add a review step at end (only on first step field)
  /** Auto-fill from the logged-in user's profile when the form loads. */
  autoFill?: "user.name" | "user.email" | "user.employeeId" | "user.jobTitle" | "user.department" | "user.phone";
  /** Auto-calculate this number field from two date fields using business-day logic. */
  autoCalculate?: {
    type: "businessDays";
    startField: string;
    endField: string;
  };
  /** Look up a value from a FormData dataset and auto-populate this field when a trigger field changes. */
  lookupFormData?: {
    slug: string;
    returnField: string;
    matchField: string;
    matchDatasetField?: string;
    extraFilters?: Record<string, string>;
  };
  // Casefolder / XML mapping
  fieldLevel?: "casefolder" | "document"; // batch-level = casefolder, document-level = per-file
  xmlFieldName?: string; // exact XML field name from scanner (e.g., "Student Name", "Document Description")
  usedInTitle?: boolean; // include this field in the auto-generated document title
  isAggregationKey?: boolean; // group documents into folders by this field's value
}

type FieldType = FormField["type"];

interface FieldPaletteItem {
  type: FieldType;
  label: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_GROUPS: { title: string; items: FieldPaletteItem[] }[] = [
  {
    title: "Basic Fields",
    items: [
      { type: "text", label: "Text Input", icon: "T" },
      { type: "textarea", label: "Text Area", icon: "\u00b6" },
      { type: "number", label: "Number", icon: "#" },
      { type: "email", label: "Email", icon: "@" },
      { type: "phone", label: "Phone", icon: "\u260e" },
    ],
  },
  {
    title: "Selection Fields",
    items: [
      { type: "select", label: "Dropdown", icon: "\u25be" },
      { type: "multiselect", label: "Multi-select", icon: "\u2611" },
      { type: "radio", label: "Radio Buttons", icon: "\u25c9" },
      { type: "checkbox", label: "Checkboxes", icon: "\u2611" },
    ],
  },
  {
    title: "Date & Time",
    items: [
      { type: "date", label: "Date", icon: "\ud83d\udcc5" },
      { type: "datetime", label: "Date & Time", icon: "\ud83d\udd52" },
    ],
  },
  {
    title: "Advanced",
    items: [
      { type: "file", label: "File Upload", icon: "\ud83d\udcce" },
      { type: "table", label: "Table", icon: "\u2637" },
      { type: "richtext", label: "Rich Text", icon: "\u270d" },
    ],
  },
  {
    title: "Layout",
    items: [
      { type: "section", label: "Section Header", icon: "H" },
      { type: "divider", label: "Divider", icon: "\u2500" },
      { type: "step", label: "Form Step", icon: "\u2630" },
    ],
  },
  {
    title: "People",
    items: [
      { type: "user_picker", label: "User Selector", icon: "\u263A" },
      { type: "multi_user_picker", label: "Multi-User Selector", icon: "\u2687" },
    ],
  },
];

const DEFAULT_LABELS: Record<FieldType, string> = {
  text: "Text Field",
  textarea: "Text Area",
  number: "Number Field",
  email: "Email Address",
  phone: "Phone Number",
  date: "Date",
  datetime: "Date & Time",
  select: "Dropdown",
  multiselect: "Multi-select",
  radio: "Radio Group",
  checkbox: "Checkbox Group",
  file: "File Upload",
  section: "Section Title",
  divider: "",
  richtext: "Rich Text",
  table: "Data Table",
  step: "Step",
  user_picker: "User Selector",
  multi_user_picker: "Multi-User Selector",
};

const SELECTION_TYPES: FieldType[] = ["select", "multiselect", "radio", "checkbox"];
const TEXT_TYPES: FieldType[] = ["text", "textarea", "email", "phone"];

function generateId(): string {
  return "field_" + Math.random().toString(36).slice(2, 9);
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ---------------------------------------------------------------------------
// SVG Icons (inline, no external deps)
// ---------------------------------------------------------------------------

function IconGripVertical({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconChevronUp({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function IconChevronDown({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconMinus({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
    </svg>
  );
}

function IconEye({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconEyeOff({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function IconArrowLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function IconSave({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Field type icon component for canvas cards
// ---------------------------------------------------------------------------

function FieldTypeIcon({ type, className = "w-5 h-5" }: { type: FieldType; className?: string }) {
  const map: Record<FieldType, string> = {
    text: "T",
    textarea: "\u00b6",
    number: "#",
    email: "@",
    phone: "\u260e",
    date: "\ud83d\udcc5",
    datetime: "\ud83d\udd52",
    select: "\u25be",
    multiselect: "\u2611",
    radio: "\u25c9",
    checkbox: "\u2611",
    file: "\ud83d\udcce",
    section: "H",
    divider: "\u2014",
    richtext: "\u270d",
    table: "\u2637",
    step: "\u2630",
    user_picker: "\u263A",
    multi_user_picker: "\u2687",
  };
  return (
    <span className={`inline-flex items-center justify-center text-sm font-bold ${className}`}>
      {map[type] ?? "?"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section helper
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-200 dark:border-gray-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {title}
        {open ? <IconChevronUp className="w-3.5 h-3.5" /> : <IconChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && <div className="px-4 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable input components for properties panel
// ---------------------------------------------------------------------------

function PropLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
    >
      {children}
    </label>
  );
}

function PropInput({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
    />
  );
}

function PropCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/30 w-4 h-4"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
        {label}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// FormDesignerInner (uses useSearchParams, needs Suspense boundary)
// ---------------------------------------------------------------------------

function FormDesignerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const formId = searchParams.get("id");

  useEffect(() => {
    if (status === "loading") return;
    const perms = session?.user?.permissions ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("forms:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  // ---- State ----
  const [formName, setFormName] = useState("Untitled Form");
  const [formDescription, setFormDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(!!formId);
  const [existingId, setExistingId] = useState<string | null>(formId);
  const [workflowTemplateId, setWorkflowTemplateId] = useState<string | null>(null);
  const [workflowTemplates, setWorkflowTemplates] = useState<{ id: string; name: string }[]>([]);
  const [formDataSchemas, setFormDataSchemas] = useState<{ id: string; name: string; slug: string; fields: { name: string; label: string }[] }[]>([]);

  // ---- Local draft (auto-save) ----
  const [draftBanner, setDraftBanner] = useState<{ savedAt: string; key: string } | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track unsaved changes
  const markDirty = useCallback(() => setHasUnsaved(true), []);

  // ---- Selected field ----
  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId]
  );

  // ---- Load existing template ----
  useEffect(() => {
    if (!formId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        if (cancelled) return;
        setFormName(data.name ?? "Untitled Form");
        setFormDescription(data.description ?? "");
        setFields(data.fields ?? []);
        setIsPublished(!!data.isActive);
        setExistingId(data.id ?? formId);
        setWorkflowTemplateId(data.workflowTemplateId ?? null);

        // Check for a local draft newer than the server copy
        try {
          const draftKey = `form-draft-${data.id ?? formId}`;
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const draft = JSON.parse(raw) as { savedAt?: string };
            if (draft.savedAt && !cancelled) setDraftBanner({ savedAt: draft.savedAt, key: draftKey });
          }
        } catch {}
      } catch {
        if (!cancelled) {
          setSaveMsg({ type: "error", text: "Failed to load form template." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  // ---- Fetch workflow templates for linking ----
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workflows/templates?all=true");
        if (!res.ok) return;
        const data = await res.json();
        const templates = (data.templates ?? data ?? []) as {
          id: string;
          name: string;
        }[];
        setWorkflowTemplates(
          Array.isArray(templates) ? templates.map((t) => ({ id: t.id, name: t.name })) : []
        );
      } catch {
        // Silently ignore -- workflow templates are optional
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/form-data");
        if (!res.ok) return;
        const data = await res.json();
        const schemas = (data.schemas ?? []) as {
          id: string; name: string; slug: string;
          fields?: { name: string; label: string }[];
        }[];
        setFormDataSchemas(schemas.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          fields: s.fields ?? [],
        })));
      } catch {
        // Silently ignore
      }
    })();
  }, []);

  // Check for a saved draft when creating a new form
  useEffect(() => {
    if (formId) return; // existing forms: draft check happens after server load below
    try {
      const raw = localStorage.getItem("form-draft-new");
      if (!raw) return;
      const draft = JSON.parse(raw) as { savedAt?: string };
      if (draft.savedAt) setDraftBanner({ savedAt: draft.savedAt, key: "form-draft-new" });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save to localStorage (30 s after last change)
  useEffect(() => {
    if (!hasUnsaved) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      try {
        const key = `form-draft-${existingId ?? "new"}`;
        localStorage.setItem(key, JSON.stringify({
          existingId,
          formName,
          formDescription,
          fields,
          isPublished,
          workflowTemplateId,
          savedAt: new Date().toISOString(),
        }));
      } catch {}
    }, 30_000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsaved, existingId, formName, formDescription, fields, isPublished, workflowTemplateId]);

  // Save immediately to localStorage before the page unloads
  useEffect(() => {
    function handleBeforeUnload() {
      if (!hasUnsaved) return;
      try {
        const key = `form-draft-${existingId ?? "new"}`;
        localStorage.setItem(key, JSON.stringify({
          existingId,
          formName,
          formDescription,
          fields,
          isPublished,
          workflowTemplateId,
          savedAt: new Date().toISOString(),
        }));
      } catch {}
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsaved, existingId, formName, formDescription, fields, isPublished, workflowTemplateId]);

  // ---- Add field ----
  const addField = useCallback(
    (type: FieldType) => {
      const label = DEFAULT_LABELS[type];
      const newField: FormField = {
        id: generateId(),
        type,
        label,
        name: slugify(label),
        width: "full",
      };
      if (SELECTION_TYPES.includes(type)) {
        newField.options = [
          { label: "Option 1", value: "option_1" },
          { label: "Option 2", value: "option_2" },
        ];
      }
      if (type === "table") {
        newField.tableColumns = [
          { label: "Column 1", name: "col_1", type: "text" },
        ];
      }
      if (type === "multi_user_picker") {
        newField.maxUsers = 5;
        newField.orderable = true;
      }
      setFields((prev) => [...prev, newField]);
      setSelectedFieldId(newField.id);
      markDirty();
    },
    [markDirty]
  );

  // ---- Update field ----
  const updateField = useCallback(
    (id: string, patch: Partial<FormField>) => {
      setFields((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
      );
      markDirty();
    },
    [markDirty]
  );

  // ---- Delete field ----
  const deleteField = useCallback(
    (id: string) => {
      setFields((prev) => prev.filter((f) => f.id !== id));
      if (selectedFieldId === id) setSelectedFieldId(null);
      markDirty();
    },
    [selectedFieldId, markDirty]
  );

  // ---- Move field ----
  const moveField = useCallback(
    (id: string, direction: "up" | "down") => {
      setFields((prev) => {
        const idx = prev.findIndex((f) => f.id === id);
        if (idx === -1) return prev;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;
        const copy = [...prev];
        [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
        return copy;
      });
      markDirty();
    },
    [markDirty]
  );

  // ---- Duplicate field ----
  const duplicateField = useCallback(
    (id: string) => {
      setFields((prev) => {
        const idx = prev.findIndex((f) => f.id === id);
        if (idx === -1) return prev;
        const orig = prev[idx];
        const dup: FormField = {
          ...JSON.parse(JSON.stringify(orig)),
          id: generateId(),
          name: orig.name + "_copy",
          label: orig.label + " (Copy)",
        };
        const copy = [...prev];
        copy.splice(idx + 1, 0, dup);
        return copy;
      });
      markDirty();
    },
    [markDirty]
  );

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!formName.trim()) {
      setSaveMsg({ type: "error", text: "Form name is required." });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        fields,
        isActive: isPublished,
        workflowTemplateId: workflowTemplateId || undefined,
      };
      let res: Response;
      if (existingId) {
        res = await fetch(`/api/forms/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/forms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      const result = await res.json();
      if (!existingId && result.id) {
        setExistingId(result.id);
      }
      // Clear local draft after successful server save
      try { localStorage.removeItem(`form-draft-${existingId ?? "new"}`); } catch {}
      setDraftBanner(null);
      setHasUnsaved(false);
      setSaveMsg({ type: "success", text: "Form saved successfully!" });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save form.",
      });
    } finally {
      setSaving(false);
    }
  }, [formName, formDescription, fields, isPublished, existingId, workflowTemplateId]);

  // ---- Evaluate visibility condition for preview ----
  const isFieldVisible = useCallback(
    (field: FormField, formValues: Record<string, string>) => {
      if (!field.condition) return true;
      const { fieldId, operator, value } = field.condition;
      // Values are stored by field.name; conditions reference field.id — resolve it
      const referencedField = fields.find((f) => f.id === fieldId);
      const actual = formValues[referencedField?.name ?? fieldId] ?? "";
      switch (operator) {
        case "equals":
          return actual === (value ?? "");
        case "not_equals":
          return actual !== (value ?? "");
        case "contains":
          return actual.includes(value ?? "");
        case "not_empty":
          return actual.length > 0;
        case "empty":
          return actual.length === 0;
        default:
          return true;
      }
    },
    [fields]
  );

  function restoreLocalDraft(key: string) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.formName !== undefined) setFormName(draft.formName);
      if (draft.formDescription !== undefined) setFormDescription(draft.formDescription);
      if (Array.isArray(draft.fields)) setFields(draft.fields);
      if (draft.isPublished !== undefined) setIsPublished(draft.isPublished);
      if (draft.workflowTemplateId !== undefined) setWorkflowTemplateId(draft.workflowTemplateId);
      if (draft.existingId) setExistingId(draft.existingId);
    } catch {}
    setDraftBanner(null);
  }

  function discardLocalDraft(key: string) {
    try { localStorage.removeItem(key); } catch {}
    setDraftBanner(null);
  }

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center">
          <Spinner className="w-8 h-8 text-[#02773b] mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Loading form designer...
          </p>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // PREVIEW MODE
  // ===========================================================================

  if (isPreview) {
    return <PreviewMode
      formName={formName}
      fields={fields}
      isFieldVisible={isFieldVisible}
      onExitPreview={() => setIsPreview(false)}
    />;
  }

  // ===========================================================================
  // Render a single field card (reused by both casefolder and document sections)
  // ===========================================================================
  function renderFieldCard(field: FormField, idx: number) {
    const isSelected = selectedFieldId === field.id;
    const isHalf = field.width === "half" && field.type !== "step" && field.type !== "multi_user_picker";

    return (
      <div
        className={`${isHalf ? "inline-block align-top w-[calc(50%-4px)] mr-2 last:mr-0" : "block w-full"}`}
      >
        <div
          onClick={() => setSelectedFieldId(field.id)}
          className={`rounded-xl border-2 p-3 cursor-pointer transition-all group ${
            field.type === "step"
              ? "bg-[#02773b]/5 dark:bg-[#02773b]/10"
              : "bg-white dark:bg-gray-900"
          } ${
            isSelected
              ? "border-[#02773b] shadow-sm shadow-[#02773b]/10"
              : field.type === "step"
                ? "border-[#02773b]/20 dark:border-[#02773b]/30 hover:border-[#02773b]/40"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
          }`}
        >
          {field.type === "divider" ? (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Divider</span>
              <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }} disabled={idx === 0} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move up"><IconChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }} disabled={idx === fields.length - 1} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move down"><IconChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteField(field.id); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500" title="Delete"><IconTrash className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : field.type === "section" ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex-shrink-0 w-7 h-7 rounded-md bg-[#02773b]/10 flex items-center justify-center text-sm font-bold text-[#02773b]">H</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{field.label || "Section Header"}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{field.name}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }} disabled={idx === 0} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move up"><IconChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }} disabled={idx === fields.length - 1} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move down"><IconChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteField(field.id); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500" title="Delete"><IconTrash className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : field.type === "step" ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#02773b] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {fields.filter((f) => f.type === "step").indexOf(field) + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{field.label || "Step"}</p>
                    {field.helpText && <p className="text-[10px] text-gray-500 truncate">{field.helpText}</p>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }} disabled={idx === 0} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move up"><IconChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }} disabled={idx === fields.length - 1} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move down"><IconChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteField(field.id); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500" title="Delete"><IconTrash className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 pt-0.5">
                <span className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <FieldTypeIcon type={field.type} className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{field.label || "(No label)"}</p>
                  {field.required && <span className="text-red-500 text-xs font-bold">*</span>}
                  {field.isAggregationKey && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#dd9f42]/10 text-[#dd9f42] rounded">Key</span>}
                  {field.usedInTitle && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#02773b]/10 text-[#02773b] rounded">Title</span>}
                  {field.condition && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 rounded">Cond</span>}
                  {field.hidden && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-400 rounded">Hidden</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-400 font-mono truncate">{field.name}</span>
                  <span className="text-[10px] text-gray-400">{field.type}</span>
                  {field.xmlFieldName && <span className="text-[10px] text-gray-400 font-mono">xml:{field.xmlFieldName}</span>}
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }} disabled={idx === 0} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move up"><IconChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }} disabled={idx === fields.length - 1} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400" title="Move down"><IconChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteField(field.id); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500" title="Delete"><IconTrash className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===========================================================================
  // DESIGNER MODE
  // ===========================================================================

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Draft restore banner */}
      {draftBanner && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-sm">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-amber-800 dark:text-amber-300 flex-1">
            You have unsaved local changes from {new Date(draftBanner.savedAt).toLocaleString()}. Restore them?
          </span>
          <button
            onClick={() => restoreLocalDraft(draftBanner.key)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Restore
          </button>
          <button
            onClick={() => discardLocalDraft(draftBanner.key)}
            className="px-3 py-1 text-xs font-semibold rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          >
            Discard
          </button>
        </div>
      )}
      {/* ================================================================ */}
      {/* TOP TOOLBAR                                                      */}
      {/* ================================================================ */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Back */}
          <button
            onClick={() => router.push("/forms")}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Back to forms"
          >
            <IconArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Forms</span>
          </button>

          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

          {/* Form name */}
          <input
            type="text"
            value={formName}
            onChange={(e) => {
              setFormName(e.target.value);
              markDirty();
            }}
            placeholder="Form name..."
            className="h-9 flex-1 min-w-0 max-w-md rounded-lg border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-[#02773b] bg-transparent px-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
          />

          <div className="flex-1" />

          {/* Linked Workflow selector */}
          {workflowTemplates.length > 0 && (
            <div className="flex items-center gap-1.5">
              {workflowTemplateId && (
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 px-2 py-1 rounded-lg">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                  </svg>
                  Workflow linked
                </span>
              )}
              <select
                value={workflowTemplateId ?? ""}
                onChange={(e) => {
                  setWorkflowTemplateId(e.target.value || null);
                  markDirty();
                }}
                className="h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors max-w-[180px]"
                title="Link a workflow template"
              >
                <option value="">No workflow</option>
                {workflowTemplates.map((wt) => (
                  <option key={wt.id} value={wt.id}>
                    {wt.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Preview toggle */}
          <button
            onClick={() => setIsPreview(true)}
            className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
            title="Preview form"
          >
            <IconEye className="w-4 h-4" />
            <span className="hidden sm:inline">Preview</span>
          </button>

          {/* Publish toggle */}
          <button
            onClick={() => {
              setIsPublished((p) => !p);
              markDirty();
            }}
            className={`h-9 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              isPublished
                ? "border-[#02773b]/30 bg-[#02773b]/10 text-[#02773b] dark:border-[#02773b]/40 dark:bg-[#02773b]/20 dark:text-emerald-400"
                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
            title={isPublished ? "Unpublish form" : "Publish form"}
          >
            {isPublished ? (
              <IconCheck className="w-4 h-4" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.97.633-3.792 1.708-5.27" />
              </svg>
            )}
            <span className="hidden sm:inline">
              {isPublished ? "Published" : "Publish"}
            </span>
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-4 rounded-lg bg-[#02773b] hover:bg-[#026332] text-white text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 relative"
          >
            {saving ? <Spinner className="w-4 h-4" /> : <IconSave className="w-4 h-4" />}
            <span className="hidden sm:inline">Save</span>
            {hasUnsaved && !saving && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#dd9f42] border-2 border-white dark:border-gray-900" />
            )}
          </button>
        </div>

        {/* Save message */}
        {saveMsg && (
          <div
            className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              saveMsg.type === "success"
                ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
            }`}
          >
            {saveMsg.text}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* 3-PANEL LAYOUT                                                    */}
      {/* ================================================================ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ============================================================ */}
        {/* LEFT PANEL -- Field Palette                                    */}
        {/* ============================================================ */}
        <div className="flex-shrink-0 w-[220px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
          <div className="p-3">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1 mb-3">
              Field Palette
            </h3>

            {FIELD_GROUPS.map((group) => (
              <div key={group.title} className="mb-4">
                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 mb-1.5">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addField(item.type)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-[#dd9f42]/10 hover:text-[#dd9f42] dark:hover:text-[#dd9f42] transition-colors group"
                    >
                      <span className="flex-shrink-0 w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400 group-hover:bg-[#dd9f42]/20 group-hover:text-[#dd9f42] transition-colors">
                        {item.icon}
                      </span>
                      <span className="truncate font-medium">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ============================================================ */}
        {/* CENTER -- Form Canvas                                          */}
        {/* ============================================================ */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100 dark:bg-gray-950">
          <div className="max-w-3xl mx-auto py-6 px-4">
            {/* Form header area */}
            <div className="mb-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {formName || "Untitled Form"}
              </h2>
              {formDescription && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {formDescription}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {fields.length} field{fields.length !== 1 ? "s" : ""} — {fields.filter((f) => f.fieldLevel !== "document").length} casefolder, {fields.filter((f) => f.fieldLevel === "document").length} document
              </p>
            </div>

            {/* Empty state */}
            {fields.length === 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Click a field type from the palette to start building your form
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Fields will appear here as you add them
                </p>
              </div>
            )}

            {/* ---- CASEFOLDER FIELDS section ---- */}
            {fields.some((f) => f.fieldLevel !== "document") && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#02773b]" />
                  <h3 className="text-xs font-bold text-[#02773b] uppercase tracking-wider">Casefolder Fields</h3>
                  <span className="text-[10px] text-gray-400">— shared across all documents in the folder</span>
                </div>
                <div className="space-y-2 pl-3 border-l-2 border-[#02773b]/20">
                  {fields.filter((f) => f.fieldLevel !== "document").map((field) => {
                    const idx = fields.indexOf(field);
                    return <div key={field.id}>{renderFieldCard(field, idx)}</div>;
                  })}
                </div>
              </div>
            )}

            {/* ---- DOCUMENT FIELDS section ---- */}
            {fields.some((f) => f.fieldLevel === "document") && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <h3 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Document Fields</h3>
                  <span className="text-[10px] text-gray-400">— specific to each document (title, description, etc.)</span>
                </div>
                <div className="space-y-2 pl-3 border-l-2 border-blue-500/20">
                  {fields.filter((f) => f.fieldLevel === "document").map((field) => {
                    const idx = fields.indexOf(field);
                    return <div key={field.id}>{renderFieldCard(field, idx)}</div>;
                  })}
                </div>
              </div>
            )}

            {/* Unsectioned fields (legacy / no fieldLevel set — show as before) */}
            <div className="space-y-2" style={{ display: "none" }}>
              {fields.map((field, idx) => {
                const isSelected = selectedFieldId === field.id;
                const isHalf = field.width === "half";

                // For half-width: check if this is paired with the previous or should start a new row
                // We'll render inline logic; pair half-width fields on the same row
                return (
                  <div
                    key={field.id}
                    className={`${isHalf ? "inline-block align-top w-[calc(50%-4px)] mr-2 last:mr-0" : "block w-full"}`}
                  >
                    <div
                      onClick={() => setSelectedFieldId(field.id)}
                      className={`bg-white dark:bg-gray-900 rounded-xl border-2 p-3 cursor-pointer transition-all group ${
                        isSelected
                          ? "border-[#02773b] shadow-sm shadow-[#02773b]/10"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#dd9f42]/50"
                      }`}
                    >
                      {/* Field type: divider gets special rendering */}
                      {field.type === "divider" ? (
                        <div className="flex items-center gap-3 py-1">
                          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Divider</span>
                          <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600" />
                          {/* Actions */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }}
                              disabled={idx === 0}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move up"
                            >
                              <IconChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }}
                              disabled={idx === fields.length - 1}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move down"
                            >
                              <IconChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500"
                              title="Delete"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : field.type === "section" ? (
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="flex-shrink-0 w-7 h-7 rounded-md bg-[#02773b]/10 flex items-center justify-center text-sm font-bold text-[#02773b]">
                                H
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                                  {field.label || "Section Header"}
                                </p>
                                <p className="text-[10px] text-gray-400 font-mono">{field.name}</p>
                              </div>
                            </div>
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }}
                              disabled={idx === 0}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move up"
                            >
                              <IconChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }}
                              disabled={idx === fields.length - 1}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move down"
                            >
                              <IconChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500"
                              title="Delete"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Regular field card */
                        <div className="flex items-start gap-3">
                          {/* Drag/type indicator */}
                          <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
                            <span className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                              <FieldTypeIcon type={field.type} className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                            </span>
                          </div>

                          {/* Field info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {field.label || "(No label)"}
                              </p>
                              {field.required && (
                                <span className="flex-shrink-0 text-red-500 text-xs font-bold">*</span>
                              )}
                              {field.width === "half" && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 rounded">
                                  Half
                                </span>
                              )}
                              {field.condition && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded">
                                  Conditional
                                </span>
                              )}
                              {field.isAggregationKey && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-[#dd9f42]/10 text-[#dd9f42] dark:text-amber-400 rounded">
                                  Key
                                </span>
                              )}
                              {field.fieldLevel === "document" && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded">
                                  Doc
                                </span>
                              )}
                              {field.usedInTitle && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-[#02773b]/10 dark:bg-[#02773b]/20 text-[#02773b] dark:text-emerald-400 rounded">
                                  Title
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-gray-400 font-mono truncate">
                                {field.name}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {field.type}
                              </span>
                              {field.xmlFieldName && (
                                <span className="text-[10px] text-gray-400 font-mono truncate" title={`XML: ${field.xmlFieldName}`}>
                                  xml:{field.xmlFieldName}
                                </span>
                              )}
                            </div>
                            {field.helpText && (
                              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                                {field.helpText}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "up"); }}
                              disabled={idx === 0}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move up"
                            >
                              <IconChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveField(field.id, "down"); }}
                              disabled={idx === fields.length - 1}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-400"
                              title="Move down"
                            >
                              <IconChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); duplicateField(field.id); }}
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
                              title="Duplicate"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500"
                              title="Delete"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* RIGHT PANEL -- Properties                                      */}
        {/* ============================================================ */}
        <div className="flex-shrink-0 w-[300px] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto">
          {selectedField ? (
            <PropertiesPanel
              field={selectedField}
              allFields={fields}
              formDataSchemas={formDataSchemas}
              onUpdate={(patch) => updateField(selectedField.id, patch)}
              onDelete={() => deleteField(selectedField.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Select a field to edit its properties
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Click any field on the canvas
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Properties Panel Component
// ===========================================================================

function PropertiesPanel({
  field,
  allFields,
  formDataSchemas,
  onUpdate,
  onDelete,
}: {
  field: FormField;
  allFields: FormField[];
  formDataSchemas: { id: string; name: string; slug: string; fields: { name: string; label: string }[] }[];
  onUpdate: (patch: Partial<FormField>) => void;
  onDelete: () => void;
}) {
  const isTextLike = TEXT_TYPES.includes(field.type);
  const isSelection = SELECTION_TYPES.includes(field.type);
  const isNumber = field.type === "number";
  const isTable = field.type === "table";
  const isLayout = field.type === "section" || field.type === "divider" || field.type === "step";
  const isUserPicker = field.type === "user_picker";
  const isMultiUserPicker = field.type === "multi_user_picker";
  const isAnyUserPicker = isUserPicker || isMultiUserPicker;
  const isStep = field.type === "step";

  // Other fields for conditional visibility (exclude layout types that have no value)
  const otherFields = allFields.filter((f) => f.id !== field.id && f.type !== "divider" && f.type !== "section" && f.type !== "step");

  // Other user picker fields for excludeFields
  const otherUserPickerFields = allFields.filter(
    (f) => f.id !== field.id && (f.type === "user_picker" || f.type === "multi_user_picker")
  );

  // Check if this is the first step field in the form
  const isFirstStep = isStep && allFields.filter((f) => f.type === "step").indexOf(field) === 0;

  // The trigger field for conditions
  const conditionTriggerField = field.condition
    ? allFields.find((f) => f.id === field.condition!.fieldId)
    : null;

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Properties
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {field.type} field
          </p>
        </div>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          title="Delete field"
        >
          <IconTrash className="w-4 h-4" />
        </button>
      </div>

      {/* General */}
      <CollapsibleSection title="General">
        <div>
          <PropLabel htmlFor="prop-label">Label</PropLabel>
          <PropInput
            id="prop-label"
            value={field.label}
            onChange={(v) => {
              const newName = slugify(v);
              onUpdate({ label: v, name: newName });
            }}
            placeholder="Field label"
          />
        </div>
        <div>
          <PropLabel htmlFor="prop-name">Field Name</PropLabel>
          <PropInput
            id="prop-name"
            value={field.name}
            onChange={(v) => onUpdate({ name: slugify(v) })}
            placeholder="field_name"
          />
          <p className="text-[10px] text-gray-400 mt-0.5">Auto-generated from label. Must be unique.</p>
        </div>
        {isStep && (
          <div>
            <PropLabel htmlFor="prop-helptext">Description</PropLabel>
            <PropInput
              id="prop-helptext"
              value={field.helpText ?? ""}
              onChange={(v) => onUpdate({ helpText: v || undefined })}
              placeholder="Step description"
            />
          </div>
        )}
        {isStep && isFirstStep && (
          <PropCheckbox
            label="Auto-add Review step at end"
            checked={!!field.includeReviewStep}
            onChange={(v) => onUpdate({ includeReviewStep: v })}
          />
        )}
        {!isLayout && (
          <>
            <div>
              <PropLabel htmlFor="prop-placeholder">Placeholder</PropLabel>
              <PropInput
                id="prop-placeholder"
                value={field.placeholder ?? ""}
                onChange={(v) => onUpdate({ placeholder: v || undefined })}
                placeholder="Enter placeholder text..."
              />
            </div>
            <div>
              <PropLabel htmlFor="prop-helptext">Help Text</PropLabel>
              <PropInput
                id="prop-helptext"
                value={field.helpText ?? ""}
                onChange={(v) => onUpdate({ helpText: v || undefined })}
                placeholder="Help text shown below field"
              />
            </div>

            {/* Auto-fill from logged-in user profile */}
            {(field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "select") && (
              <div>
                <PropLabel htmlFor="prop-autofill">Auto-fill from profile</PropLabel>
                <select
                  id="prop-autofill"
                  value={field.autoFill ?? ""}
                  onChange={(e) => onUpdate({ autoFill: (e.target.value as FormField["autoFill"]) || undefined })}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-[#02773b]/40"
                >
                  <option value="">None (manual input)</option>
                  <option value="user.name">Full Name</option>
                  <option value="user.email">Email Address</option>
                  <option value="user.employeeId">Personal Number (P/No.)</option>
                  <option value="user.jobTitle">Job Title</option>
                  <option value="user.department">Department / School</option>
                  <option value="user.phone">Phone Number</option>
                </select>
                {field.autoFill && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    This field will be pre-filled when the form loads.
                  </p>
                )}
              </div>
            )}

            {isMultiUserPicker ? (
              <div>
                <PropLabel>Width</PropLabel>
                <p className="text-[10px] text-gray-400">Multi-User Selector is always full width</p>
              </div>
            ) : (
            <div>
              <PropLabel>Width</PropLabel>
              <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                <button
                  type="button"
                  onClick={() => onUpdate({ width: "full" })}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    field.width !== "half"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  Full Width
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ width: "half" })}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600 ${
                    field.width === "half"
                      ? "bg-[#02773b] text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  Half Width
                </button>
              </div>
            </div>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* User Picker Settings */}
      {isAnyUserPicker && (
        <CollapsibleSection title="User Picker Settings">
          <PropCheckbox
            label="Filter by submitter's department"
            checked={!!field.filterByMyDepartment}
            onChange={(v) => onUpdate({ filterByMyDepartment: v || undefined })}
          />
          <p className="text-[10px] text-gray-400 -mt-1">
            Skips the department dropdown and automatically shows only colleagues from the same department as the person filling the form
          </p>
          {isMultiUserPicker && (
            <>
              <div>
                <PropLabel htmlFor="prop-maxusers">Max Users</PropLabel>
                <PropInput
                  id="prop-maxusers"
                  type="number"
                  value={field.maxUsers ?? 5}
                  onChange={(v) => onUpdate({ maxUsers: v ? parseInt(v) : 5 })}
                  placeholder="5"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Maximum number of users that can be selected</p>
              </div>
              <PropCheckbox
                label="Allow reordering"
                checked={field.orderable ?? true}
                onChange={(v) => onUpdate({ orderable: v })}
              />
            </>
          )}
          {otherUserPickerFields.length > 0 && (
            <div>
              <PropLabel>Exclude users from</PropLabel>
              <div className="space-y-1.5 mt-1">
                {otherUserPickerFields.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={(field.excludeFields ?? []).includes(f.id)}
                      onChange={(e) => {
                        const current = field.excludeFields ?? [];
                        const next = e.target.checked
                          ? [...current, f.id]
                          : current.filter((id) => id !== f.id);
                        onUpdate({ excludeFields: next.length ? next : undefined });
                      }}
                      className="rounded border-gray-300 dark:border-gray-600 text-[#02773b] focus:ring-[#02773b]/30 w-4 h-4"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors truncate">
                      {f.label} ({f.type === "user_picker" ? "Single" : "Multi"})
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Users selected in checked fields will be excluded from this picker</p>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Validation */}
      {!isLayout && !isAnyUserPicker && (
        <CollapsibleSection title="Validation">
          <PropCheckbox
            label="Required"
            checked={!!field.required}
            onChange={(v) => onUpdate({ required: v })}
          />
          <PropCheckbox
            label="Read Only"
            checked={!!field.readOnly}
            onChange={(v) => onUpdate({ readOnly: v })}
          />
          <PropCheckbox
            label="Hide on layout"
            checked={!!field.hidden}
            onChange={(v) => onUpdate({ hidden: v })}
          />
          {field.hidden && (
            <p className="text-[10px] text-gray-400 -mt-1 ml-6">
              This field won&apos;t be shown when viewing or editing a record
            </p>
          )}

          {/* Text-specific validation */}
          {isTextLike && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <PropLabel>Min Length</PropLabel>
                  <PropInput
                    type="number"
                    value={field.validation?.minLength ?? ""}
                    onChange={(v) =>
                      onUpdate({
                        validation: {
                          ...field.validation,
                          minLength: v ? parseInt(v) : undefined,
                        },
                      })
                    }
                    placeholder="0"
                  />
                </div>
                <div>
                  <PropLabel>Max Length</PropLabel>
                  <PropInput
                    type="number"
                    value={field.validation?.maxLength ?? ""}
                    onChange={(v) =>
                      onUpdate({
                        validation: {
                          ...field.validation,
                          maxLength: v ? parseInt(v) : undefined,
                        },
                      })
                    }
                    placeholder="None"
                  />
                </div>
              </div>
              <div>
                <PropLabel>Pattern (Regex)</PropLabel>
                <PropInput
                  value={field.validation?.pattern ?? ""}
                  onChange={(v) =>
                    onUpdate({
                      validation: { ...field.validation, pattern: v || undefined },
                    })
                  }
                  placeholder="^[A-Z].*"
                />
              </div>
              <div>
                <PropLabel>Pattern Error Message</PropLabel>
                <PropInput
                  value={field.validation?.patternMessage ?? ""}
                  onChange={(v) =>
                    onUpdate({
                      validation: {
                        ...field.validation,
                        patternMessage: v || undefined,
                      },
                    })
                  }
                  placeholder="Invalid format"
                />
              </div>
            </>
          )}

          {/* Number-specific validation */}
          {isNumber && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <PropLabel>Min Value</PropLabel>
                <PropInput
                  type="number"
                  value={field.validation?.min ?? ""}
                  onChange={(v) =>
                    onUpdate({
                      validation: {
                        ...field.validation,
                        min: v ? parseFloat(v) : undefined,
                      },
                    })
                  }
                  placeholder="None"
                />
              </div>
              <div>
                <PropLabel>Max Value</PropLabel>
                <PropInput
                  type="number"
                  value={field.validation?.max ?? ""}
                  onChange={(v) =>
                    onUpdate({
                      validation: {
                        ...field.validation,
                        max: v ? parseFloat(v) : undefined,
                      },
                    })
                  }
                  placeholder="None"
                />
              </div>
            </div>
          )}

          {/* Date range restrictions */}
          {(field.type === "date" || field.type === "datetime") && (
            <>
              <div>
                <PropLabel>Earliest Date (min)</PropLabel>
                <select
                  value={field.validation?.minDate ?? ""}
                  onChange={(e) =>
                    onUpdate({ validation: { ...field.validation, minDate: e.target.value || undefined } })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none"
                >
                  <option value="">No restriction</option>
                  <option value="today">Today (cannot pick past dates)</option>
                  <option value="startOfYear">Start of current calendar year (Jan 1)</option>
                  <option value="endOfYear">Start of current calendar year end (Dec 31)</option>
                  <option value="startOfFinancialYear">Start of financial year (Jul 1)</option>
                  <option value="startOfMonth">Start of current month</option>
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">Or type an ISO date: 2026-01-01</p>
                {field.validation?.minDate && !["today","startOfYear","endOfYear","startOfFinancialYear","endOfFinancialYear","startOfMonth","endOfMonth"].includes(field.validation.minDate) && (
                  <PropInput
                    value={field.validation.minDate}
                    onChange={(v) => onUpdate({ validation: { ...field.validation, minDate: v || undefined } })}
                    placeholder="YYYY-MM-DD"
                  />
                )}
              </div>
              <div>
                <PropLabel>Latest Date (max)</PropLabel>
                <select
                  value={field.validation?.maxDate ?? ""}
                  onChange={(e) =>
                    onUpdate({ validation: { ...field.validation, maxDate: e.target.value || undefined } })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none"
                >
                  <option value="">No restriction</option>
                  <option value="today">Today (cannot pick future dates)</option>
                  <option value="endOfYear">End of current calendar year (Dec 31)</option>
                  <option value="endOfFinancialYear">End of financial year (Jun 30)</option>
                  <option value="endOfMonth">End of current month</option>
                </select>
                {field.validation?.maxDate && !["today","startOfYear","endOfYear","startOfFinancialYear","endOfFinancialYear","startOfMonth","endOfMonth"].includes(field.validation.maxDate) && (
                  <PropInput
                    value={field.validation.maxDate}
                    onChange={(v) => onUpdate({ validation: { ...field.validation, maxDate: v || undefined } })}
                    placeholder="YYYY-MM-DD"
                  />
                )}
              </div>
            </>
          )}

          {/* Cross-field comparison rules */}
          {(field.type === "date" || field.type === "datetime" || field.type === "number" || field.type === "text") && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <PropLabel>Cross-field Rules</PropLabel>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      validation: {
                        ...field.validation,
                        crossFieldRules: [
                          ...(field.validation?.crossFieldRules ?? []),
                          { compareTo: "", operator: "gte" as const, message: "" },
                        ],
                      },
                    })
                  }
                  className="text-[10px] text-[#02773b] hover:underline font-medium"
                >
                  + Add Rule
                </button>
              </div>
              {(field.validation?.crossFieldRules ?? []).map((rule, idx) => (
                <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1.5 bg-gray-50 dark:bg-gray-800/40">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">This field must be</span>
                    <select
                      value={rule.operator}
                      onChange={(e) => {
                        const updated = [...(field.validation?.crossFieldRules ?? [])];
                        updated[idx] = { ...rule, operator: e.target.value as typeof rule.operator };
                        onUpdate({ validation: { ...field.validation, crossFieldRules: updated } });
                      }}
                      className="h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 text-[10px] text-gray-900 dark:text-gray-100 outline-none"
                    >
                      <option value="gte">≥ (greater than or equal)</option>
                      <option value="gt">&gt; (greater than)</option>
                      <option value="lte">≤ (less than or equal)</option>
                      <option value="lt">&lt; (less than)</option>
                      <option value="eq">= (equal to)</option>
                      <option value="neq">≠ (not equal to)</option>
                    </select>
                  </div>
                  <div>
                    <PropLabel>Compare to field</PropLabel>
                    <select
                      value={rule.compareTo}
                      onChange={(e) => {
                        const updated = [...(field.validation?.crossFieldRules ?? [])];
                        updated[idx] = { ...rule, compareTo: e.target.value };
                        onUpdate({ validation: { ...field.validation, crossFieldRules: updated } });
                      }}
                      className="w-full h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-[10px] text-gray-900 dark:text-gray-100 outline-none"
                    >
                      <option value="">— select field —</option>
                      {otherFields
                        .filter((f) => f.type === field.type || (field.type === "date" && f.type === "datetime") || f.type === "number")
                        .map((f) => (
                          <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <PropLabel>Error message</PropLabel>
                    <PropInput
                      value={rule.message}
                      onChange={(v) => {
                        const updated = [...(field.validation?.crossFieldRules ?? [])];
                        updated[idx] = { ...rule, message: v };
                        onUpdate({ validation: { ...field.validation, crossFieldRules: updated } });
                      }}
                      placeholder="e.g. End date cannot be before start date"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (field.validation?.crossFieldRules ?? []).filter((_, i) => i !== idx);
                      onUpdate({ validation: { ...field.validation, crossFieldRules: updated.length ? updated : undefined } });
                    }}
                    className="text-[10px] text-red-500 hover:underline"
                  >
                    Remove rule
                  </button>
                </div>
              ))}
              {(field.validation?.crossFieldRules?.length ?? 0) === 0 && (
                <p className="text-[10px] text-gray-400">
                  No rules yet. Use this to enforce relationships like &quot;End date ≥ Start date&quot; or &quot;Days requested ≤ Balance remaining&quot;.
                </p>
              )}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Auto-calculate business days (number fields only) */}
      {isNumber && (
        <CollapsibleSection title="Auto-Calculation">
          <PropCheckbox
            label="Auto-calculate business days from date range"
            checked={field.autoCalculate?.type === "businessDays"}
            onChange={(v) =>
              onUpdate({
                autoCalculate: v
                  ? { type: "businessDays", startField: "", endField: "" }
                  : undefined,
                readOnly: v ? true : field.readOnly,
              })
            }
          />
          {field.autoCalculate?.type === "businessDays" && (
            <>
              <div>
                <PropLabel>Start Date Field</PropLabel>
                <select
                  value={field.autoCalculate.startField}
                  onChange={(e) =>
                    onUpdate({ autoCalculate: { ...field.autoCalculate!, startField: e.target.value } })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none"
                >
                  <option value="">— select field —</option>
                  {allFields
                    .filter((f) => f.type === "date" || f.type === "datetime")
                    .map((f) => (
                      <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                    ))}
                </select>
              </div>
              <div>
                <PropLabel>End Date Field</PropLabel>
                <select
                  value={field.autoCalculate.endField}
                  onChange={(e) =>
                    onUpdate({ autoCalculate: { ...field.autoCalculate!, endField: e.target.value } })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none"
                >
                  <option value="">— select field —</option>
                  {allFields
                    .filter((f) => f.type === "date" || f.type === "datetime")
                    .map((f) => (
                      <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                    ))}
                </select>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
                This field will auto-populate with the number of business days between the two selected dates, using the configured Work Calendar (Admin → Work Calendar). Weekends and public holidays are excluded automatically.
              </p>
            </>
          )}
        </CollapsibleSection>
      )}

      {/* Form Data Lookup (number + text fields) */}
      {(isNumber || field.type === "text") && (() => {
        const selSchema = formDataSchemas.find((s) => s.slug === field.lookupFormData?.slug);
        const dsFields = selSchema?.fields ?? [];

        // Token options for filter values
        const TOKEN_OPTIONS = [
          { value: "user.employeeId", label: "Current user — Employee ID" },
          { value: "user.department",  label: "Current user — Department" },
          { value: "currentYear",      label: "Current year" },
        ];

        const SELECT_CLS =
          "w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none";

        return (
          <CollapsibleSection title="Form Data Lookup">
            <PropCheckbox
              label="Auto-populate from a Form Data dataset"
              checked={!!field.lookupFormData}
              onChange={(v) =>
                onUpdate({
                  lookupFormData: v
                    ? { slug: "", returnField: "", matchField: "", matchDatasetField: "", extraFilters: { employee_id: "user.employeeId", year: "currentYear" } }
                    : undefined,
                  readOnly: v ? true : field.readOnly,
                })
              }
            />
            {field.lookupFormData && (
              <>
                {/* ── Dataset ── */}
                <div>
                  <PropLabel>Dataset</PropLabel>
                  <select
                    value={field.lookupFormData.slug}
                    onChange={(e) => onUpdate({ lookupFormData: { ...field.lookupFormData!, slug: e.target.value, returnField: "", matchDatasetField: "", extraFilters: {} } })}
                    className={SELECT_CLS}
                  >
                    <option value="">— select dataset —</option>
                    {formDataSchemas.map((s) => (
                      <option key={s.id} value={s.slug}>{s.name} ({s.slug})</option>
                    ))}
                  </select>
                </div>

                {/* ── Trigger Field (form field that fires the lookup) ── */}
                <div>
                  <PropLabel>Trigger Field</PropLabel>
                  <select
                    value={field.lookupFormData.matchField}
                    onChange={(e) => onUpdate({ lookupFormData: { ...field.lookupFormData!, matchField: e.target.value } })}
                    className={SELECT_CLS}
                  >
                    <option value="">— pick a form field —</option>
                    {allFields
                      .filter((f) => f.id !== field.id)
                      .map((f) => (
                        <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                      ))}
                  </select>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">When this field changes the lookup fires.</p>
                </div>

                {/* ── Dataset Field to Match ── */}
                <div>
                  <PropLabel>Dataset Field to Match</PropLabel>
                  <select
                    value={field.lookupFormData.matchDatasetField ?? ""}
                    onChange={(e) => onUpdate({ lookupFormData: { ...field.lookupFormData!, matchDatasetField: e.target.value || undefined } })}
                    className={SELECT_CLS}
                    disabled={dsFields.length === 0}
                  >
                    <option value="">{dsFields.length === 0 ? "— select dataset first —" : "— same as trigger field name —"}</option>
                    {dsFields.map((f) => (
                      <option key={f.name} value={f.name}>{f.label || f.name} ({f.name})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Dataset column compared against the trigger value.</p>
                </div>

                {/* ── Return Field ── */}
                <div>
                  <PropLabel>Return Field</PropLabel>
                  <select
                    value={field.lookupFormData.returnField}
                    onChange={(e) => onUpdate({ lookupFormData: { ...field.lookupFormData!, returnField: e.target.value } })}
                    className={SELECT_CLS}
                    disabled={dsFields.length === 0}
                  >
                    <option value="">{dsFields.length === 0 ? "— select dataset first —" : "— pick a column —"}</option>
                    {dsFields.map((f) => (
                      <option key={f.name} value={f.name}>{f.label || f.name} ({f.name})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">The dataset column whose value is written into this field.</p>
                </div>

                {/* ── Extra Filters ── */}
                <div>
                  <PropLabel>Extra Filters</PropLabel>
                  <div className="space-y-1.5">
                    {Object.entries(field.lookupFormData.extraFilters ?? {}).map(([dsField, valToken]) => (
                      <div key={dsField} className="flex gap-1 items-center">
                        {/* Key — dataset field */}
                        <select
                          value={dsField}
                          onChange={(e) => {
                            const next = { ...field.lookupFormData!.extraFilters };
                            delete next[dsField];
                            next[e.target.value] = valToken;
                            onUpdate({ lookupFormData: { ...field.lookupFormData!, extraFilters: next } });
                          }}
                          className="flex-1 h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] outline-none"
                        >
                          <option value={dsField}>{dsField}</option>
                          {dsFields
                            .filter((f) => !(f.name in (field.lookupFormData!.extraFilters ?? {})) || f.name === dsField)
                            .map((f) => (
                              <option key={f.name} value={f.name}>{f.label || f.name}</option>
                            ))}
                        </select>
                        <span className="text-gray-400 text-xs">=</span>
                        {/* Value — token or form field */}
                        <select
                          value={valToken}
                          onChange={(e) => {
                            const next = { ...field.lookupFormData!.extraFilters, [dsField]: e.target.value };
                            onUpdate({ lookupFormData: { ...field.lookupFormData!, extraFilters: next } });
                          }}
                          className="flex-1 h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] outline-none"
                        >
                          <optgroup label="Built-in tokens">
                            {TOKEN_OPTIONS.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Form fields">
                            {allFields
                              .filter((f) => f.id !== field.id)
                              .map((f) => (
                                <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                              ))}
                          </optgroup>
                        </select>
                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...field.lookupFormData!.extraFilters };
                            delete next[dsField];
                            onUpdate({ lookupFormData: { ...field.lookupFormData!, extraFilters: next } });
                          }}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {/* Add filter row */}
                    <button
                      type="button"
                      onClick={() => {
                        const existing = Object.keys(field.lookupFormData!.extraFilters ?? {});
                        const nextField = dsFields.find((f) => !existing.includes(f.name));
                        const key = nextField?.name ?? `field_${existing.length + 1}`;
                        onUpdate({ lookupFormData: { ...field.lookupFormData!, extraFilters: { ...(field.lookupFormData!.extraFilters ?? {}), [key]: "user.employeeId" } } });
                      }}
                      className="flex items-center gap-1 text-[11px] text-[#02773b] hover:text-[#02773b]/80 font-medium transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add filter
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">Additional dataset columns to narrow the lookup to a single record.</p>
                </div>
              </>
            )}
          </CollapsibleSection>
        );
      })()}

      {/* Validation for user pickers (just Required) */}
      {isAnyUserPicker && (
        <CollapsibleSection title="Validation">
          <PropCheckbox
            label="Required"
            checked={!!field.required}
            onChange={(v) => onUpdate({ required: v })}
          />
        </CollapsibleSection>
      )}

      {/* Options (for select, multiselect, radio, checkbox) */}
      {isSelection && (
        <CollapsibleSection title="Options">
          {/* Data Source Toggle */}
          <div>
            <PropLabel>Option Source</PropLabel>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
              <button
                type="button"
                onClick={() => onUpdate({ dataSource: undefined })}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  !field.dataSource
                    ? "bg-[#02773b] text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Static
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ dataSource: { type: "departments" }, options: undefined })}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600 ${
                  field.dataSource
                    ? "bg-[#02773b] text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                Dynamic
              </button>
            </div>
          </div>

          {/* Dynamic data source configuration */}
          {field.dataSource && (
            <>
              <div>
                <PropLabel>Data Source</PropLabel>
                <select
                  value={field.dataSource.type}
                  onChange={(e) => {
                    const dsType = e.target.value as FormField["dataSource"] extends { type: infer T } ? T : never;
                    onUpdate({
                      dataSource: {
                        type: dsType as any,
                        ...(dsType === "api" ? { endpoint: "", labelField: "name", valueField: "id" } : {}),
                        ...(dsType === "users" ? { dependsOn: "" } : {}),
                      },
                    });
                  }}
                  className="w-full h-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                >
                  <option value="departments">Departments</option>
                  <option value="users">Users (by Department)</option>
                  <option value="roles">Roles</option>
                  <option value="casefolders">Casefolders</option>
                  <option value="api">Custom API</option>
                </select>
              </div>

              {/* Description of selected source */}
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
                <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                  {field.dataSource.type === "departments" && "Fetches all departments from the system. Options auto-update as departments are added."}
                  {field.dataSource.type === "users" && !field.dataSource.filterByMyDepartment && !field.dataSource.dependsOn && "Fetches all active users. Use 'Filter by my department' or 'Depends on' to narrow the list."}
                  {field.dataSource.type === "users" && field.dataSource.filterByMyDepartment && "Shows only users from the submitter's own department — no extra field needed."}
                  {field.dataSource.type === "users" && !field.dataSource.filterByMyDepartment && field.dataSource.dependsOn && "Fetches users filtered by a department field. Set 'Depends on' to link to a department dropdown."}
                  {field.dataSource.type === "roles" && "Fetches all roles defined in the system."}
                  {field.dataSource.type === "casefolders" && "Fetches all active casefolder names."}
                  {field.dataSource.type === "api" && "Fetches options from a custom API endpoint. Response must be a JSON array."}
                </p>
              </div>

              {/* Users: filter options */}
              {field.dataSource.type === "users" && (
                <>
                  {/* Filter by my department toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!field.dataSource.filterByMyDepartment}
                      onChange={(e) =>
                        onUpdate({
                          dataSource: {
                            ...field.dataSource!,
                            filterByMyDepartment: e.target.checked || undefined,
                            dependsOn: e.target.checked ? undefined : field.dataSource!.dependsOn,
                          },
                        })
                      }
                      className="rounded border-gray-300 text-[#02773b] focus:ring-[#02773b]/30"
                    />
                    <span className="text-xs text-gray-700 dark:text-gray-300">Filter by submitter&apos;s department</span>
                  </label>
                  <p className="text-[10px] text-gray-400 -mt-1">
                    Auto-populates with colleagues from the same department as the person filling the form
                  </p>

                  {/* Depends-on picker — only shown when filterByMyDepartment is off */}
                  {!field.dataSource.filterByMyDepartment && (
                    <div>
                      <PropLabel>Depends On (Department Field)</PropLabel>
                      <select
                        value={field.dataSource.dependsOn ?? ""}
                        onChange={(e) =>
                          onUpdate({
                            dataSource: { ...field.dataSource!, dependsOn: e.target.value || undefined },
                          })
                        }
                        className="w-full h-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                      >
                        <option value="">All users (no filter)</option>
                        {allFields
                          .filter((f) => f.id !== field.id && (f.type === "select" || f.type === "text"))
                          .map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.label} ({f.name})
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        When a department is selected in that field, this list filters to its members
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Custom API */}
              {field.dataSource.type === "api" && (
                <>
                  <div>
                    <PropLabel htmlFor="prop-ds-endpoint">API Endpoint</PropLabel>
                    <PropInput
                      id="prop-ds-endpoint"
                      value={field.dataSource.endpoint ?? ""}
                      onChange={(v) =>
                        onUpdate({ dataSource: { ...field.dataSource!, endpoint: v } })
                      }
                      placeholder="/api/custom/options"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <PropLabel>Label Field</PropLabel>
                      <PropInput
                        value={field.dataSource.labelField ?? "name"}
                        onChange={(v) =>
                          onUpdate({ dataSource: { ...field.dataSource!, labelField: v || "name" } })
                        }
                        placeholder="name"
                      />
                    </div>
                    <div>
                      <PropLabel>Value Field</PropLabel>
                      <PropInput
                        value={field.dataSource.valueField ?? "id"}
                        onChange={(v) =>
                          onUpdate({ dataSource: { ...field.dataSource!, valueField: v || "id" } })
                        }
                        placeholder="id"
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Static options (only when not using data source) */}
          {!field.dataSource && (
            <>
              <div className="space-y-2">
                {(field.options ?? []).map((opt, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="flex-1 grid grid-cols-2 gap-1">
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const newOpts = [...(field.options ?? [])];
                          newOpts[i] = {
                            ...newOpts[i],
                            label: e.target.value,
                            value: slugify(e.target.value),
                          };
                          onUpdate({ options: newOpts });
                        }}
                        placeholder="Label"
                        className="h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                      />
                      <input
                        type="text"
                        value={opt.value}
                        onChange={(e) => {
                          const newOpts = [...(field.options ?? [])];
                          newOpts[i] = { ...newOpts[i], value: e.target.value };
                          onUpdate({ options: newOpts });
                        }}
                        placeholder="Value"
                        className="h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 font-mono placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (i === 0) return;
                        const newOpts = [...(field.options ?? [])];
                        [newOpts[i - 1], newOpts[i]] = [newOpts[i], newOpts[i - 1]];
                        onUpdate({ options: newOpts });
                      }}
                      disabled={i === 0}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move up"
                    >
                      <IconChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        const opts = field.options ?? [];
                        if (i >= opts.length - 1) return;
                        const newOpts = [...opts];
                        [newOpts[i], newOpts[i + 1]] = [newOpts[i + 1], newOpts[i]];
                        onUpdate({ options: newOpts });
                      }}
                      disabled={i >= (field.options ?? []).length - 1}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move down"
                    >
                      <IconChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        const newOpts = (field.options ?? []).filter((_, j) => j !== i);
                        onUpdate({ options: newOpts });
                      }}
                      className="p-0.5 rounded text-gray-400 hover:text-red-500"
                      title="Remove option"
                    >
                      <IconMinus className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const newOpts = [
                    ...(field.options ?? []),
                    { label: `Option ${(field.options ?? []).length + 1}`, value: `option_${(field.options ?? []).length + 1}` },
                  ];
                  onUpdate({ options: newOpts });
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-[#02773b] hover:text-[#026332] transition-colors"
              >
                <IconPlus className="w-3.5 h-3.5" />
                Add option
              </button>
            </>
          )}
        </CollapsibleSection>
      )}

      {/* Table Columns */}
      {isTable && (
        <CollapsibleSection title="Table Columns">
          <div className="space-y-2">
            {(field.tableColumns ?? []).map((col, i) => (
              <div key={i} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={col.label}
                    onChange={(e) => {
                      const newCols = [...(field.tableColumns ?? [])];
                      newCols[i] = {
                        ...newCols[i],
                        label: e.target.value,
                        name: slugify(e.target.value),
                      };
                      onUpdate({ tableColumns: newCols });
                    }}
                    placeholder="Column label"
                    className="flex-1 h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => {
                      const newCols = [...(field.tableColumns ?? [])];
                      newCols[i] = { ...newCols[i], type: e.target.value };
                      onUpdate({ tableColumns: newCols });
                    }}
                    className="h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-xs text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Select</option>
                  </select>
                  <button
                    onClick={() => {
                      const newCols = (field.tableColumns ?? []).filter((_, j) => j !== i);
                      onUpdate({ tableColumns: newCols });
                    }}
                    className="p-0.5 rounded text-gray-400 hover:text-red-500"
                    title="Remove column"
                  >
                    <IconMinus className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 font-mono pl-1">{col.name}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const newCols = [
                ...(field.tableColumns ?? []),
                {
                  label: `Column ${(field.tableColumns ?? []).length + 1}`,
                  name: `col_${(field.tableColumns ?? []).length + 1}`,
                  type: "text",
                },
              ];
              onUpdate({ tableColumns: newCols });
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-[#02773b] hover:text-[#026332] transition-colors"
          >
            <IconPlus className="w-3.5 h-3.5" />
            Add column
          </button>
        </CollapsibleSection>
      )}

      {/* Conditional Visibility */}
      {!isLayout && (
        <CollapsibleSection title="Conditional Visibility" defaultOpen={false}>
          <PropCheckbox
            label="Enable condition"
            checked={!!field.condition}
            onChange={(v) => {
              if (v) {
                onUpdate({
                  condition: {
                    fieldId: otherFields[0]?.id ?? "",
                    operator: "not_empty",
                  },
                });
              } else {
                onUpdate({ condition: undefined });
              }
            }}
          />
          {field.condition && (
            <>
              <div>
                <PropLabel>Show this field when</PropLabel>
                <select
                  value={field.condition.fieldId}
                  onChange={(e) =>
                    onUpdate({
                      condition: { ...field.condition!, fieldId: e.target.value },
                    })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                >
                  <option value="">-- select field --</option>
                  {otherFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <PropLabel>Operator</PropLabel>
                <select
                  value={field.condition.operator}
                  onChange={(e) =>
                    onUpdate({
                      condition: {
                        ...field.condition!,
                        operator: e.target.value as NonNullable<FormField["condition"]>["operator"],
                      },
                    })
                  }
                  className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                >
                  <option value="equals">Equals</option>
                  <option value="not_equals">Not equals</option>
                  <option value="contains">Contains</option>
                  <option value="not_empty">Is not empty</option>
                  <option value="empty">Is empty</option>
                </select>
              </div>
              {field.condition.operator !== "not_empty" &&
                field.condition.operator !== "empty" && (
                  <div>
                    <PropLabel>Value</PropLabel>
                    {conditionTriggerField &&
                    SELECTION_TYPES.includes(conditionTriggerField.type) &&
                    conditionTriggerField.options?.length ? (
                      <select
                        value={field.condition.value ?? ""}
                        onChange={(e) =>
                          onUpdate({
                            condition: {
                              ...field.condition!,
                              value: e.target.value,
                            },
                          })
                        }
                        className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
                      >
                        <option value="">-- select value --</option>
                        {conditionTriggerField.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <PropInput
                        value={field.condition.value ?? ""}
                        onChange={(v) =>
                          onUpdate({
                            condition: { ...field.condition!, value: v },
                          })
                        }
                        placeholder="Value to compare"
                      />
                    )}
                  </div>
                )}
            </>
          )}
        </CollapsibleSection>
      )}

      {/* Default Value */}
      {!isLayout && !isAnyUserPicker && (
        <CollapsibleSection title="Default Value" defaultOpen={false}>
          <div>
            <PropLabel>Default value</PropLabel>
            {isSelection && field.options?.length ? (
              <select
                value={(field.defaultValue as string) ?? ""}
                onChange={(e) => onUpdate({ defaultValue: e.target.value || undefined })}
                className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
              >
                <option value="">-- none --</option>
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <PropInput
                value={(field.defaultValue as string) ?? ""}
                onChange={(v) => onUpdate({ defaultValue: v || undefined })}
                placeholder={`Default ${field.type} value`}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              />
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Casefolder & XML Mapping */}
      {!isLayout && (
        <CollapsibleSection title="Casefolder & XML Mapping" defaultOpen={false}>
          {/* Field level */}
          <div>
            <PropLabel>Field Level</PropLabel>
            <select
              value={field.fieldLevel ?? "casefolder"}
              onChange={(e) =>
                onUpdate({ fieldLevel: e.target.value as "casefolder" | "document" })
              }
              className="w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/30 outline-none transition-colors"
            >
              <option value="casefolder">Casefolder (shared across documents)</option>
              <option value="document">Document (per file)</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              {field.fieldLevel === "document"
                ? "This field varies per document in the casefolder (e.g., Document Description, Folio Number)"
                : "This field is the same for all documents in the casefolder (e.g., Student Name, Reg Number)"}
            </p>
          </div>

          {/* XML Field Name */}
          <div>
            <PropLabel>XML Field Name</PropLabel>
            <PropInput
              value={field.xmlFieldName ?? ""}
              onChange={(v) => onUpdate({ xmlFieldName: v || undefined })}
              placeholder="e.g. Student Name"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Exact field name from the scanner XML sidecar file. Leave blank to match by label.
            </p>
          </div>

          {/* Aggregation key */}
          <PropCheckbox
            label="Aggregation key (group documents)"
            checked={field.isAggregationKey ?? false}
            onChange={(v) => onUpdate({ isAggregationKey: v })}
          />
          {field.isAggregationKey && (
            <div className="p-2 rounded-lg bg-[#dd9f42]/10 border border-[#dd9f42]/20 -mt-1">
              <p className="text-[10px] text-[#dd9f42] dark:text-amber-400 font-medium">
                Documents will be grouped into folders by this field
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                e.g. All documents with the same &quot;{field.label || "value"}&quot; will appear in one folder
              </p>
            </div>
          )}

          {/* Used in title */}
          <PropCheckbox
            label="Include in document title"
            checked={field.usedInTitle ?? false}
            onChange={(v) => onUpdate({ usedInTitle: v })}
          />
          {field.usedInTitle && (
            <p className="text-[10px] text-gray-400 -mt-1 ml-6">
              This field&apos;s value will be used to auto-generate the document title
            </p>
          )}

          {/* Preview of XML mapping */}
          <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">XML mapping preview:</p>
            <code className="text-[10px] font-mono text-[#02773b] dark:text-emerald-400">
              &lt;field name=&quot;{field.xmlFieldName || field.label}&quot; level=&quot;{field.fieldLevel === "document" ? "document" : "batch"}&quot; value=&quot;...&quot;/&gt;
            </code>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ===========================================================================
// Preview Mode Component
// ===========================================================================

function PreviewMode({
  formName,
  fields,
  onExitPreview,
}: {
  formName: string;
  fields: FormField[];
  isFieldVisible: (field: FormField, values: Record<string, string>) => boolean;
  onExitPreview: () => void;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  function handleChange(name: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Preview toolbar */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={onExitPreview}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <IconArrowLeft className="w-4 h-4" />
            <span>Back to Designer</span>
          </button>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs font-medium text-amber-700 dark:text-amber-400">
            <IconEye className="w-3.5 h-3.5" />
            Preview Mode
          </span>
        </div>
      </div>

      {/* Preview form */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-8 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            {/* Form header */}
            <div className="bg-[#02773b] px-6 py-5">
              <h1 className="text-lg font-bold text-white">{formName || "Untitled Form"}</h1>
            </div>

            {/* Form body — rendered by the shared FormRenderer */}
            <div className="p-6">
              <FormRenderer
                fields={fields as unknown as RendererFormField[]}
                formData={formData}
                onChange={handleChange}
              />
            </div>

            {/* Submit button (preview only) */}
            <div className="px-6 pb-6">
              <button
                type="button"
                disabled
                className="w-full py-2.5 rounded-xl bg-[#02773b] text-white text-sm font-semibold opacity-50 cursor-not-allowed"
              >
                Submit (preview only)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ===========================================================================
// Page export with Suspense boundary for useSearchParams
// ===========================================================================

export default function FormDesignerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <Spinner className="w-8 h-8 text-[#02773b] mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Loading form designer...
            </p>
          </div>
        </div>
      }
    >
      <FormDesignerInner />
    </Suspense>
  );
}
