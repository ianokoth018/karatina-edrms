"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Built-in schema templates ─────────────────────────────────────────────
const BUILT_IN_TEMPLATES = [
  {
    name: "Leave Types",
    slug: "leave_types",
    description: "Defines each leave type, entitlement days, gender rules, and policies",
    icon: "📋",
    fields: [
      { id: "f1", name: "type_name",             label: "Leave Type",                type: "text",    required: true },
      { id: "f2", name: "days_male",              label: "Days Granted (Male)",        type: "number",  required: true },
      { id: "f3", name: "days_female",            label: "Days Granted (Female)",      type: "number",  required: true },
      { id: "f4", name: "max_consecutive_days",   label: "Max Consecutive Days",       type: "number",  required: false },
      { id: "f5", name: "carries_over",           label: "Carries Over to Next Year",  type: "boolean", required: false },
      { id: "f6", name: "requires_medical",       label: "Requires Medical Certificate", type: "boolean", required: false },
      { id: "f7", name: "requires_hod_approval",  label: "Requires HOD Approval",      type: "boolean", required: false },
      { id: "f8", name: "requires_hr_approval",   label: "Requires HR Approval",       type: "boolean", required: false },
      { id: "f9", name: "applicable_gender",      label: "Applicable Gender",          type: "select",  required: false, options: ["All", "Male", "Female"] },
      { id: "f10", name: "notes",                 label: "Notes",                      type: "text",    required: false },
    ],
  },
  {
    name: "Leave Balances",
    slug: "leave_balances",
    description: "Per-employee leave balance records — granted, used, and remaining days",
    icon: "📊",
    fields: [
      { id: "f1", name: "employee_id",    label: "Employee / Staff ID",   type: "text",   required: true },
      { id: "f2", name: "employee_name",  label: "Employee Name",          type: "text",   required: true },
      { id: "f3", name: "department",     label: "Department",             type: "text",   required: false },
      { id: "f4", name: "leave_type",     label: "Leave Type",             type: "text",   required: true },
      { id: "f5", name: "year",           label: "Year",                   type: "number", required: true },
      { id: "f6", name: "days_granted",   label: "Days Granted",           type: "number", required: true },
      { id: "f7", name: "days_used",      label: "Days Used",              type: "number", required: true },
      { id: "f8", name: "balance",        label: "Remaining Balance",      type: "number", required: true },
      { id: "f9", name: "last_updated",   label: "Last Updated",           type: "date",   required: false },
    ],
  },
  {
    name: "Staff Grades",
    slug: "staff_grades",
    description: "Job grades with their leave entitlements and other HR parameters",
    icon: "🎓",
    fields: [
      { id: "f1", name: "grade",               label: "Grade / Level",          type: "text",   required: true },
      { id: "f2", name: "title",               label: "Job Title / Category",   type: "text",   required: false },
      { id: "f3", name: "annual_leave_days",   label: "Annual Leave Days",      type: "number", required: true },
      { id: "f4", name: "sick_leave_days",     label: "Sick Leave Days",        type: "number", required: true },
      { id: "f5", name: "study_leave_days",    label: "Study Leave Days",       type: "number", required: false },
      { id: "f6", name: "salary_scale",        label: "Salary Scale",           type: "text",   required: false },
    ],
  },
  {
    name: "Departments",
    slug: "departments",
    description: "Department registry with heads and metadata for workflow routing",
    icon: "🏢",
    fields: [
      { id: "f1", name: "name",        label: "Department Name",    type: "text",  required: true },
      { id: "f2", name: "code",        label: "Department Code",    type: "text",  required: false },
      { id: "f3", name: "hod_name",    label: "Head of Department", type: "text",  required: false },
      { id: "f4", name: "hod_email",   label: "HOD Email",          type: "email", required: false },
      { id: "f5", name: "cluster",     label: "Cluster / Faculty",  type: "text",  required: false },
      { id: "f6", name: "is_academic", label: "Is Academic",        type: "boolean", required: false },
    ],
  },
];

interface Schema {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { records: number };
}

export default function FormDataListPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const [newForm, setNewForm] = useState({ name: "", slug: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) router.replace("/dashboard");
  }, [session, status, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/form-data");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSchemas(data.schemas ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  async function createSchema(payload: { name: string; slug: string; description: string; fields: object[] }) {
    setCreating(true); setError(null);
    try {
      const res = await fetch("/api/admin/form-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.push(`/admin/form-data/${data.schema.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setCreating(false);
    }
  }

  async function handleNewSubmit(e: React.FormEvent) {
    e.preventDefault();
    await createSchema({ name: newForm.name, slug: newForm.slug || autoSlug(newForm.name), description: newForm.description, fields: [] });
  }

  async function useTemplate(tpl: typeof BUILT_IN_TEMPLATES[0]) {
    await createSchema({ name: tpl.name, slug: tpl.slug, description: tpl.description, fields: tpl.fields });
  }

  const filtered = schemas.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Form Data</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Define structured data registries — leave types, balances, grades — that workflows can query at runtime.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => { setShowTemplates(true); setShowNew(false); }}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
            </svg>
            Use Template
          </button>
          <button
            onClick={() => { setShowNew(true); setShowTemplates(false); }}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Dataset
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Template picker */}
      {showTemplates && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-[#02773b]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quick-start Templates</h2>
            <button onClick={() => setShowTemplates(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUILT_IN_TEMPLATES.map((tpl) => {
              const alreadyExists = schemas.some((s) => s.slug === tpl.slug);
              return (
                <div key={tpl.slug} className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-[#02773b]/40 transition-colors">
                  <span className="text-2xl flex-shrink-0">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tpl.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tpl.description}</p>
                    <p className="text-xs text-gray-400 mt-1 font-mono">{tpl.fields.length} fields predefined</p>
                  </div>
                  <button
                    onClick={() => useTemplate(tpl)}
                    disabled={creating || alreadyExists}
                    className="flex-shrink-0 h-8 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {alreadyExists ? "Exists" : creating ? "…" : "Use"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New schema form */}
      {showNew && (
        <form onSubmit={handleNewSubmit} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-[#02773b]/5 to-transparent">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Dataset</h2>
            <button type="button" onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Dataset Name *</label>
              <input
                required
                value={newForm.name}
                onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value, slug: autoSlug(e.target.value) }))}
                placeholder="e.g. Leave Types"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Slug <span className="text-gray-400">(used in workflow queries)</span>
              </label>
              <input
                value={newForm.slug}
                onChange={(e) => setNewForm((p) => ({ ...p, slug: e.target.value }))}
                placeholder="e.g. leave_types"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
              <input
                value={newForm.description}
                onChange={(e) => setNewForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="What data does this dataset store?"
                className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
              />
            </div>
          </div>
          <div className="px-5 pb-5 flex gap-3">
            <button type="submit" disabled={creating} className="h-9 px-5 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60 transition-colors">
              {creating ? "Creating…" : "Create & Add Fields →"}
            </button>
            <button type="button" onClick={() => setShowNew(false)} className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      {schemas.length > 0 && (
        <div className="relative w-full sm:max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search datasets…"
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-[#02773b]"
          />
        </div>
      )}

      {/* Dataset grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 11.278 3.75 9m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 13.903 3.75 11.625" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No datasets yet</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Start with a template or create a custom dataset</p>
          <button
            onClick={() => setShowTemplates(true)}
            className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] transition-colors"
          >
            Browse Templates
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/admin/form-data/${s.id}`}
              className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 hover:border-[#02773b]/40 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#02773b]/10 dark:bg-[#02773b]/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 11.278 3.75 9m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125S3.75 13.903 3.75 11.625" />
                  </svg>
                </div>
                {!s.isActive && (
                  <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">Inactive</span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-[#02773b] transition-colors">{s.name}</h3>
              {s.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{s.description}</p>
              )}
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span className="font-mono bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded">{s.slug}</span>
                <span>{s._count.records} records</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
