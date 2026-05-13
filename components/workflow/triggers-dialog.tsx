"use client";

import { useEffect, useState } from "react";

type TriggerType = "document" | "form_submit" | "manual" | "scheduled";

interface TriggerCondition {
  field: string;
  operator: string;
  value: string;
}

interface Trigger {
  id: string;
  name: string;
  templateId: string;
  triggerType: TriggerType;
  formTemplateId: string | null;
  documentType: string | null;
  department: string | null;
  subjectTemplate: string | null;
  conditions: TriggerCondition[];
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  nextFireAt: string | null;
  lastFiredAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface FormTemplateLite {
  id: string;
  name: string;
}

interface TriggersDialogProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
}

/**
 * Designer-side manager for WorkflowTriggers attached to the current
 * workflow template. Lets non-devs declare "fire this workflow when…"
 * rules — form-submit, document upload, manual, or scheduled.
 */
export default function TriggersDialog({
  open,
  onClose,
  templateId,
  templateName,
}: TriggersDialogProps) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [forms, setForms] = useState<FormTemplateLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // New-trigger form state
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<TriggerType>("form_submit");
  const [newFormId, setNewFormId] = useState("");
  const [newDocType, setNewDocType] = useState("");
  const [newSubjectTemplate, setNewSubjectTemplate] = useState("");
  const [newScheduleCron, setNewScheduleCron] = useState("");
  const [newScheduleTimezone, setNewScheduleTimezone] = useState("Africa/Nairobi");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !templateId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/workflows/triggers?templateId=${templateId}&active=false`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => setTriggers((d.triggers ?? []) as Trigger[])),
      fetch("/api/forms?fields=0")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          const list = (d.templates ?? d.items ?? d ?? []) as FormTemplateLite[];
          setForms(list);
        }),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, templateId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function createTrigger() {
    if (!newName.trim()) {
      setError("Name is required");
      return;
    }
    if (newType === "form_submit" && !newFormId) {
      setError("Pick a form template");
      return;
    }
    if (newType === "scheduled" && !newScheduleCron.trim()) {
      setError("Enter a cron expression");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: newName.trim(),
        templateId,
        triggerType: newType,
        formTemplateId: newType === "form_submit" ? newFormId : undefined,
        documentType: newType === "document" ? newDocType.trim() || undefined : undefined,
        conditions: [],
        subjectTemplate: newSubjectTemplate.trim() || undefined,
        scheduleCron: newType === "scheduled" ? newScheduleCron.trim() : undefined,
        scheduleTimezone:
          newType === "scheduled"
            ? newScheduleTimezone.trim() || "Africa/Nairobi"
            : undefined,
        isActive: true,
      };
      const res = await fetch("/api/workflows/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const { trigger } = (await res.json()) as { trigger: Trigger };
      setTriggers((prev) => [trigger, ...prev]);
      setNewName("");
      setNewFormId("");
      setNewDocType("");
      setNewSubjectTemplate("");
      setNewScheduleCron("");
      setNewScheduleTimezone("Africa/Nairobi");
      setShowAdd(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: Trigger) {
    const next = !t.isActive;
    setTriggers((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x))
    );
    try {
      await fetch(`/api/workflows/triggers?id=${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      // revert
      setTriggers((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, isActive: !next } : x))
      );
    }
  }

  async function remove(t: Trigger) {
    if (!confirm(`Delete trigger "${t.name}"?`)) return;
    try {
      const res = await fetch(`/api/workflows/triggers?id=${t.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTriggers((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workflow triggers"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Triggers — {templateName}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Declare when this workflow should start automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : triggers.length === 0 && !showAdd ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-gray-800/40">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No triggers yet. Add one to auto-start this workflow.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {triggers.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t.name}
                      </span>
                      <TypeBadge type={t.triggerType} />
                      {!t.isActive && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                          paused
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {triggerSummary(t, forms)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleActive(t)}
                      className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {t.isActive ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(t)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {showAdd && (
            <div className="mt-4 rounded-lg border border-karu-green/40 bg-karu-green/5 p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase text-karu-green">
                New trigger
              </h3>
              <Labeled label="Name">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Auto-start on leave request"
                  className={inputCls}
                />
              </Labeled>
              <Labeled label="Fires on">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as TriggerType)}
                  className={inputCls}
                >
                  <option value="form_submit">Form submission</option>
                  <option value="document">Document upload (with conditions)</option>
                  <option value="manual">Manual only</option>
                  <option value="scheduled">Scheduled (cron)</option>
                </select>
              </Labeled>
              {newType === "form_submit" && (
                <Labeled label="Form template">
                  <select
                    value={newFormId}
                    onChange={(e) => setNewFormId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— select form —</option>
                    {forms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </Labeled>
              )}
              {newType === "document" && (
                <Labeled label="Document type (optional)">
                  <input
                    type="text"
                    value={newDocType}
                    onChange={(e) => setNewDocType(e.target.value)}
                    placeholder="e.g. MEMO, LETTER"
                    className={inputCls}
                  />
                </Labeled>
              )}
              {newType === "scheduled" && (
                <>
                  <Labeled label="Cron expression">
                    <input
                      type="text"
                      value={newScheduleCron}
                      onChange={(e) => setNewScheduleCron(e.target.value)}
                      placeholder="0 9 * * 1"
                      className={inputCls}
                    />
                    <span className="mt-1 block text-[10px] text-gray-500">
                      e.g. 0 9 * * 1 — every Monday 09:00
                    </span>
                  </Labeled>
                  <Labeled label="Timezone">
                    <input
                      type="text"
                      value={newScheduleTimezone}
                      onChange={(e) => setNewScheduleTimezone(e.target.value)}
                      placeholder="Africa/Nairobi"
                      className={inputCls}
                    />
                  </Labeled>
                </>
              )}
              <Labeled label="Subject template (optional)">
                <input
                  type="text"
                  value={newSubjectTemplate}
                  onChange={(e) => setNewSubjectTemplate(e.target.value)}
                  placeholder="e.g. Leave request from {{applicant_name}}"
                  className={inputCls}
                />
              </Labeled>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createTrigger}
                  disabled={saving}
                  className="rounded-md bg-karu-green px-3 py-1.5 text-xs font-medium text-white hover:bg-karu-green-dark disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Add trigger"}
                </button>
              </div>
            </div>
          )}
        </div>

        {!showAdd && (
          <footer className="flex justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-karu-green px-3 py-1.5 text-xs font-medium text-white hover:bg-karu-green-dark"
            >
              + Add trigger
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: TriggerType }) {
  const map: Record<TriggerType, { label: string; cls: string }> = {
    form_submit: {
      label: "Form submit",
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    },
    document: {
      label: "Document",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    },
    manual: {
      label: "Manual",
      cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    },
    scheduled: {
      label: "Scheduled",
      cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    },
  };
  const s = map[type] ?? map.manual;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${s.cls}`}>
      {s.label}
    </span>
  );
}

function triggerSummary(t: Trigger, forms: FormTemplateLite[]): string {
  if (t.triggerType === "form_submit") {
    const f = forms.find((x) => x.id === t.formTemplateId);
    return `Fires when "${f?.name ?? t.formTemplateId ?? "(unknown form)"}" is submitted${
      t.conditions.length ? ` and ${t.conditions.length} condition${t.conditions.length === 1 ? "" : "s"} match` : ""
    }.`;
  }
  if (t.triggerType === "document") {
    const parts: string[] = [];
    if (t.documentType) parts.push(`type=${t.documentType}`);
    if (t.department) parts.push(`dept=${t.department}`);
    if (t.conditions.length)
      parts.push(`${t.conditions.length} condition${t.conditions.length === 1 ? "" : "s"}`);
    return `Fires on document upload (${parts.join(", ") || "no filters"}).`;
  }
  if (t.triggerType === "manual") {
    return "Fires only when started by hand from the workflow start screen.";
  }
  if (t.triggerType === "scheduled") {
    if (!t.scheduleCron) return "Scheduled trigger (no cron configured).";
    const tz = t.scheduleTimezone ?? "Africa/Nairobi";
    return `Fires on cron: ${t.scheduleCron} (${tz})`;
  }
  return "Unknown trigger type.";
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full h-8 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20";
