"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldType = "text" | "number" | "date" | "boolean" | "select" | "email" | "phone";

interface FieldDef {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
}

interface Schema {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fields: FieldDef[];
  isActive: boolean;
}

interface DataRecord {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text",    label: "Text" },
  { value: "number",  label: "Number" },
  { value: "date",    label: "Date" },
  { value: "boolean", label: "Yes/No" },
  { value: "select",  label: "Dropdown" },
  { value: "email",   label: "Email" },
  { value: "phone",   label: "Phone" },
];

function uid() {
  return `f${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Options input — local state so commas don't get eaten while typing ───────
function OptionsInput({ options, onChange }: { options: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState((options ?? []).join(", "));
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(",").map((s) => s.trim()).filter(Boolean))}
      placeholder="Male, Female, Any"
      className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
    />
  );
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellInput({ field, value, onChange }: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const base = "w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b]";

  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 accent-[#02773b] mx-auto block"
      />
    );
  }
  if (field.type === "select" && field.options?.length) {
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
      className={base}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FormDataDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();

  const [schema, setSchema] = useState<Schema | null>(null);
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Tab: "records" | "schema"
  const [tab, setTab] = useState<"records" | "schema">("records");

  // Inline edits: Map<recordId, {data}>
  const [edits, setEdits] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [newRows, setNewRows] = useState<{ _tempId: string; data: Record<string, unknown> }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Import / export state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  // Schema editor state
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [schemaName, setSchemaName] = useState("");
  const [schemaDesc, setSchemaDesc] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) router.replace("/dashboard");
  }, [session, status, router]);

  const loadSchema = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/form-data/${id}`);
      if (!res.ok) { router.replace("/admin/form-data"); return; }
      const data = await res.json();
      setSchema(data.schema);
      setFields((data.schema.fields as FieldDef[]) ?? []);
      setSchemaName(data.schema.name);
      setSchemaDesc(data.schema.description ?? "");
    } catch { router.replace("/admin/form-data"); }
  }, [id, router]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-data/${id}/records?limit=200`);
      if (!res.ok) return;
      const data = await res.json();
      setRecords(data.records ?? []);
      setTotal(data.total ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadSchema(); loadRecords(); }, [loadSchema, loadRecords]);

  // ── Schema editor ──

  function addField() {
    setFields((prev) => [...prev, { id: uid(), name: "", label: "", type: "text", required: false }]);
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateField(idx: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  function autoName(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  async function saveSchema() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/admin/form-data/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schemaName, description: schemaDesc, fields }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await loadSchema();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  // ── Record management ──

  function getRecordData(rec: DataRecord): Record<string, unknown> {
    return edits.get(rec.id) ?? (rec.data as Record<string, unknown>);
  }

  function setCellValue(recordId: string, fieldName: string, value: unknown) {
    setEdits((prev) => {
      const existing = prev.get(recordId) ?? (records.find((r) => r.id === recordId)?.data as Record<string, unknown> ?? {});
      return new Map(prev).set(recordId, { ...existing, [fieldName]: value });
    });
  }

  function setNewRowValue(tempId: string, fieldName: string, value: unknown) {
    setNewRows((prev) => prev.map((r) => r._tempId === tempId ? { ...r, data: { ...r.data, [fieldName]: value } } : r));
  }

  function addNewRow() {
    const emptyData: Record<string, unknown> = {};
    (schema?.fields ?? []).forEach((f) => { emptyData[f.name] = f.type === "boolean" ? false : f.type === "number" ? 0 : ""; });
    setNewRows((prev) => [...prev, { _tempId: uid(), data: emptyData }]);
  }

  async function saveAllChanges() {
    setSaving(true); setError(null);
    try {
      // 1. Save edits to existing records
      const editPromises = Array.from(edits.entries()).map(([recordId, data]) =>
        fetch(`/api/admin/form-data/${id}/records/${recordId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        })
      );

      // 2. Create new rows
      const newPromises = newRows.map((row) =>
        fetch(`/api/admin/form-data/${id}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: row.data }),
        })
      );

      await Promise.all([...editPromises, ...newPromises]);
      setEdits(new Map());
      setNewRows([]);
      await loadRecords();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} record(s)?`)) return;
    try {
      await fetch(`/api/admin/form-data/${id}/records`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set());
      await loadRecords();
    } catch { setError("Failed to delete"); }
  }

  function discardNewRow(tempId: string) {
    setNewRows((prev) => prev.filter((r) => r._tempId !== tempId));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function downloadTemplate() {
    const res = await fetch(`/api/admin/form-data/${id}/import`);
    if (!res.ok) { setError("Failed to generate template"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${schema?.slug ?? "template"}_template.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/form-data/${id}/import`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportResult(data);
      if (data.imported > 0) await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const hasUnsaved = edits.size > 0 || newRows.length > 0;
  const fieldList = schema?.fields ?? [];

  const filteredRecords = search
    ? records.filter((r) => JSON.stringify(r.data).toLowerCase().includes(search.toLowerCase()))
    : records;

  if (!schema) {
    return (
      <div className="p-6 flex items-center gap-3 text-gray-500">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-[#02773b] rounded-full animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 animate-fade-in">
      {/* Breadcrumb + title */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/admin/form-data" className="hover:text-[#02773b]">Form Data</Link>
          <span>/</span>
          <span className="text-gray-700 dark:text-gray-300">{schema.name}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{schema.name}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Slug: <code className="font-mono text-[#02773b]">{schema.slug}</code>
              {schema.description && <span className="ml-2">· {schema.description}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-xl">
            <svg className="w-4 h-4 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            Query in workflows: <code className="font-mono text-[#02773b] ml-1">@data.{schema.slug}</code>
          </div>
        </div>
      </div>

      {/* Status banners */}
      {saved && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          Saved successfully
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}
      {importResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex flex-col gap-1 ${importResult.errors.length > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300" : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">
              Import complete — {importResult.imported} row{importResult.imported !== 1 ? "s" : ""} added
              {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}
            </span>
            <button onClick={() => setImportResult(null)} className="text-xs opacity-60 hover:opacity-100">dismiss</button>
          </div>
          {importResult.errors.map((e, i) => (
            <p key={i} className="text-xs opacity-80">{e}</p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {(["records", "schema"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-[#02773b] text-[#02773b]"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t === "records" ? `Records (${total})` : "Schema & Fields"}
          </button>
        ))}
      </div>

      {/* ── RECORDS TAB ── */}
      {tab === "records" && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full h-8 pl-8 pr-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs outline-none focus:border-[#02773b]" />
            </div>
            {selected.size > 0 && (
              <button onClick={deleteSelected} className="h-8 px-3 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50 transition-colors">
                Delete {selected.size}
              </button>
            )}
            <div className="flex-1" />
            {hasUnsaved && (
              <button onClick={() => { setEdits(new Map()); setNewRows([]); }} className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Discard
              </button>
            )}
            {hasUnsaved && (
              <button onClick={saveAllChanges} disabled={saving} className="h-8 px-4 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] disabled:opacity-60 transition-colors flex items-center gap-1.5">
                {saving ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : null}
                Save Changes
              </button>
            )}
            {/* Download template */}
            <button
              onClick={downloadTemplate}
              className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
              title="Download Excel template pre-filled with system users"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Template
            </button>
            {/* Import Excel */}
            <label className="h-8 px-3 rounded-lg border border-[#02773b] text-xs text-[#02773b] hover:bg-[#02773b]/5 transition-colors flex items-center gap-1 cursor-pointer">
              {importing ? (
                <div className="w-3.5 h-3.5 border border-[#02773b]/30 border-t-[#02773b] rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
              )}
              {importing ? "Importing…" : "Import Excel"}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} disabled={importing} />
            </label>
            <button onClick={addNewRow} className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Add Row
            </button>
          </div>

          {/* Spreadsheet */}
          {fieldList.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
              Define fields in the Schema tab first, then add records here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                    <th className="w-8 px-2 py-2.5">
                      <input type="checkbox"
                        checked={selected.size === records.length && records.length > 0}
                        onChange={(e) => setSelected(e.target.checked ? new Set(records.map((r) => r.id)) : new Set())}
                        className="h-3.5 w-3.5 rounded accent-[#02773b]"
                      />
                    </th>
                    {fieldList.map((f) => (
                      <th key={f.id} className="px-3 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {f.label}
                        {f.required && <span className="text-red-400 ml-0.5">*</span>}
                      </th>
                    ))}
                    <th className="w-8 px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {/* Existing records */}
                  {filteredRecords.map((rec) => {
                    const d = getRecordData(rec);
                    const dirty = edits.has(rec.id);
                    return (
                      <tr key={rec.id} className={`${dirty ? "bg-amber-50/50 dark:bg-amber-950/10" : "hover:bg-gray-50 dark:hover:bg-gray-800/30"} transition-colors`}>
                        <td className="w-8 px-2 py-1.5">
                          <input type="checkbox" checked={selected.has(rec.id)} onChange={() => toggleSelect(rec.id)} className="h-3.5 w-3.5 rounded accent-[#02773b]" />
                        </td>
                        {fieldList.map((f) => (
                          <td key={f.id} className="px-2 py-1.5 min-w-[100px]">
                            <CellInput field={f} value={d[f.name]} onChange={(v) => setCellValue(rec.id, f.name, v)} />
                          </td>
                        ))}
                        <td className="w-8 px-2 py-1.5">
                          {dirty && (
                            <button onClick={() => setEdits((p) => { const n = new Map(p); n.delete(rec.id); return n; })} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-400" title="Undo">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* New unsaved rows */}
                  {newRows.map((row) => (
                    <tr key={row._tempId} className="bg-[#02773b]/5 dark:bg-[#02773b]/10">
                      <td className="w-8 px-2 py-1.5">
                        <div className="w-3.5 h-3.5 rounded border-2 border-[#02773b]/30" />
                      </td>
                      {fieldList.map((f) => (
                        <td key={f.id} className="px-2 py-1.5 min-w-[100px]">
                          <CellInput field={f} value={row.data[f.name]} onChange={(v) => setNewRowValue(row._tempId, f.name, v)} />
                        </td>
                      ))}
                      <td className="w-8 px-2 py-1.5">
                        <button onClick={() => discardNewRow(row._tempId)} className="text-gray-400 hover:text-red-500 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredRecords.length === 0 && newRows.length === 0 && (
                    <tr>
                      <td colSpan={fieldList.length + 2} className="py-10 text-center text-xs text-gray-400">
                        No records yet — click <strong>Add Row</strong> to start entering data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SCHEMA TAB ── */}
      {tab === "schema" && (
        <div className="space-y-4">
          {/* Schema meta */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Dataset Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                <input value={schemaName} onChange={(e) => setSchemaName(e.target.value)} className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Slug <span className="text-gray-400">(read-only)</span></label>
                <input value={schema.slug} readOnly className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 text-sm font-mono text-gray-500 outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                <input value={schemaDesc} onChange={(e) => setSchemaDesc(e.target.value)} className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]" />
              </div>
            </div>
          </div>

          {/* Field definitions */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-[#02773b]/5 to-transparent">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fields</h3>
              <button onClick={addField} className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-[#02773b] text-white text-xs font-medium hover:bg-[#014d28] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Add Field
              </button>
            </div>

            {fields.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                No fields defined. Add fields to define the structure of this dataset.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800/60">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Label</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Field Name (key)</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Type</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Options (select)</th>
                      <th className="px-3 py-2.5 text-center text-gray-500 font-medium">Req.</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {fields.map((f, i) => (
                      <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-3 py-2">
                          <input
                            value={f.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              updateField(i, { label, name: f.name || autoName(label) });
                            }}
                            placeholder="e.g. Employee Name"
                            className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={f.name}
                            onChange={(e) => updateField(i, { name: e.target.value })}
                            placeholder="employee_name"
                            className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={f.type}
                            onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                            className="h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                          >
                            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {f.type === "select" ? (
                            <OptionsInput
                              key={f.id}
                              options={f.options ?? []}
                              onChange={(opts) => updateField(i, { options: opts })}
                            />
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} className="h-3.5 w-3.5 rounded accent-[#02773b]" />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => removeField(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Workflow usage hint */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Using this dataset in workflows</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mb-2">
              Add a <strong>System Action</strong> node with type <code className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1 rounded">lookup_form_data</code> to query records and inject the result into workflow data:
            </p>
            <pre className="text-xs bg-blue-100 dark:bg-blue-900/30 rounded-lg p-3 text-blue-800 dark:text-blue-300 overflow-x-auto">{`Dataset slug: ${schema.slug}
Filter field: employee_id
Filter value: {{staff_number}}
Inject as:    _lookup_${schema.slug}`}</pre>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              After lookup, a decision node can check <code className="font-mono">_lookup_{schema.slug}.balance</code> with operator <code className="font-mono">greater_equal</code>.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={saveSchema} disabled={saving} className="h-9 px-5 rounded-xl bg-[#02773b] text-white text-sm font-medium hover:bg-[#014d28] disabled:opacity-60 transition-colors">
              {saving ? "Saving…" : "Save Schema"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
