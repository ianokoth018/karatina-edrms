"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Rule {
  id: string;
  name: string;
  isActive: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  mailbox: string;
  fromFilter: string | null;
  subjectFilter: string | null;
  targetDepartment: string | null;
  targetDocumentType: string;
  tagsCsv: string;
  lastPolledAt: string | null;
  lastError: string | null;
  hasPassword: boolean;
  createdAt: string;
}

interface FormState {
  name: string;
  isActive: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword: string;
  mailbox: string;
  fromFilter: string;
  subjectFilter: string;
  targetDepartment: string;
  targetDocumentType: string;
  tagsCsv: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  isActive: true,
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  imapUser: "",
  imapPassword: "",
  mailbox: "INBOX",
  fromFilter: "",
  subjectFilter: "",
  targetDepartment: "",
  targetDocumentType: "EMAIL",
  tagsCsv: "email,inbound",
};

export default function EmailIngestAdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user?.permissions?.includes("admin:manage")) {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/email-ingest/rules");
      if (res.ok) {
        const json = await res.json();
        setRules(json.rules ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchRules();
  }, [status, fetchRules]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(r: Rule) {
    setEditing(r);
    setForm({
      name: r.name,
      isActive: r.isActive,
      imapHost: r.imapHost,
      imapPort: r.imapPort,
      imapSecure: r.imapSecure,
      imapUser: r.imapUser,
      imapPassword: "",
      mailbox: r.mailbox,
      fromFilter: r.fromFilter ?? "",
      subjectFilter: r.subjectFilter ?? "",
      targetDepartment: r.targetDepartment ?? "",
      targetDocumentType: r.targetDocumentType,
      tagsCsv: r.tagsCsv,
    });
    setFormError(null);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const url = editing
        ? `/api/admin/email-ingest/rules/${editing.id}`
        : "/api/admin/email-ingest/rules";
      const method = editing ? "PATCH" : "POST";
      const payload: Record<string, unknown> = {
        name: form.name,
        isActive: form.isActive,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort),
        imapSecure: form.imapSecure,
        imapUser: form.imapUser,
        mailbox: form.mailbox,
        fromFilter: form.fromFilter || null,
        subjectFilter: form.subjectFilter || null,
        targetDepartment: form.targetDepartment || null,
        targetDocumentType: form.targetDocumentType,
        tagsCsv: form.tagsCsv,
      };
      if (form.imapPassword) payload.imapPassword = form.imapPassword;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setFormError(j?.error ?? "Save failed");
      } else {
        setShowModal(false);
        await fetchRules();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(r: Rule) {
    await fetch(`/api/admin/email-ingest/rules/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !r.isActive }),
    });
    fetchRules();
  }

  async function handleDelete(r: Rule) {
    if (!confirm(`Delete rule "${r.name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/email-ingest/rules/${r.id}`, { method: "DELETE" });
    fetchRules();
  }

  async function handleTest(r: Rule) {
    setTestResult((prev) => ({ ...prev, [r.id]: { ok: false, text: "Testing..." } }));
    try {
      const res = await fetch(`/api/admin/email-ingest/rules/${r.id}/test`, {
        method: "POST",
      });
      const j = await res.json();
      if (j.ok) {
        setTestResult((prev) => ({
          ...prev,
          [r.id]: { ok: true, text: `OK — ${j.mailboxExists} message(s) in mailbox` },
        }));
      } else {
        setTestResult((prev) => ({
          ...prev,
          [r.id]: { ok: false, text: `Failed: ${j.error}` },
        }));
      }
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [r.id]: { ok: false, text: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  if (status === "loading") return null;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Inbound Email Ingest
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Auto-ingest inbound mail into EDRMS. Each rule watches one IMAP
            mailbox and persists matching messages (plus attachments) as
            Documents in the configured department, tagged for retrieval.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="h-10 px-4 rounded-xl bg-[color:var(--brand-primary)] text-white text-sm font-medium hover:opacity-90"
        >
          New rule
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No rules yet. Create one to start auto-ingesting inbound mail.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mailbox</th>
                <th className="px-4 py-3">Filters</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Last polled</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rules.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(r)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        r.isActive
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          r.isActive ? "bg-emerald-500" : "bg-gray-400"
                        }`}
                      />
                      {r.isActive ? "Active" : "Paused"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.name}</div>
                    {r.lastError ? (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5 max-w-xs truncate" title={r.lastError}>
                        {r.lastError}
                      </div>
                    ) : null}
                    {testResult[r.id] ? (
                      <div
                        className={`text-xs mt-0.5 ${
                          testResult[r.id].ok
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {testResult[r.id].text}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    <div className="font-mono text-xs">{r.imapUser}@{r.imapHost}:{r.imapPort}</div>
                    <div className="text-xs text-gray-500">{r.mailbox}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                    {r.fromFilter ? <div>from~{r.fromFilter}</div> : <div className="italic">any sender</div>}
                    {r.subjectFilter ? <div>re/{r.subjectFilter}/i</div> : <div className="italic">any subject</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                    <div>{r.targetDepartment || <span className="italic text-gray-500">GENERAL</span>}</div>
                    <div className="text-gray-500">type: {r.targetDocumentType}</div>
                    <div className="text-gray-500">tags: {r.tagsCsv}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => handleTest(r)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => openEdit(r)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(r)}
                      className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-800"
          >
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editing ? "Edit rule" : "New ingest rule"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <Field label="Name">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="IMAP host">
                  <input
                    required
                    value={form.imapHost}
                    onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                    placeholder="imap.gmail.com"
                    className={inputCls}
                  />
                </Field>
                <Field label="Port">
                  <input
                    required
                    type="number"
                    value={form.imapPort}
                    onChange={(e) => setForm({ ...form, imapPort: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Username">
                  <input
                    required
                    value={form.imapUser}
                    onChange={(e) => setForm({ ...form, imapUser: e.target.value })}
                    placeholder="ingest@example.com"
                    className={inputCls}
                  />
                </Field>
                <Field label={editing ? "Password (blank = keep)" : "Password"}>
                  <input
                    type="password"
                    required={!editing}
                    value={form.imapPassword}
                    onChange={(e) => setForm({ ...form, imapPassword: e.target.value })}
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Mailbox / Folder">
                  <input
                    value={form.mailbox}
                    onChange={(e) => setForm({ ...form, mailbox: e.target.value })}
                    placeholder="INBOX"
                    className={inputCls}
                  />
                </Field>
                <label className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={form.imapSecure}
                    onChange={(e) => setForm({ ...form, imapSecure: e.target.checked })}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Use TLS (recommended)</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="From filter (substring)">
                  <input
                    value={form.fromFilter}
                    onChange={(e) => setForm({ ...form, fromFilter: e.target.value })}
                    placeholder="@kcaa.go.ke"
                    className={inputCls}
                  />
                </Field>
                <Field label="Subject filter (regex)">
                  <input
                    value={form.subjectFilter}
                    onChange={(e) => setForm({ ...form, subjectFilter: e.target.value })}
                    placeholder="tender|RFQ"
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Target department">
                  <input
                    value={form.targetDepartment}
                    onChange={(e) => setForm({ ...form, targetDepartment: e.target.value })}
                    placeholder="PROCUREMENT"
                    className={inputCls}
                  />
                </Field>
                <Field label="Document type">
                  <input
                    value={form.targetDocumentType}
                    onChange={(e) => setForm({ ...form, targetDocumentType: e.target.value })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Tags (comma-separated)">
                <input
                  value={form.tagsCsv}
                  onChange={(e) => setForm({ ...form, tagsCsv: e.target.value })}
                  className={inputCls}
                />
              </Field>

              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
              </label>

              {formError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-4 rounded-xl bg-[color:var(--brand-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Create rule"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full h-10 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
