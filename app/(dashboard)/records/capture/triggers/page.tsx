"use client";

import { useState, useEffect } from "react";

interface CaptureProfile { id: string; name: string; }
interface CaptureTrigger {
  id: string;
  profileId: string | null;
  profile: { name: string } | null;
  documentTypeFilter: string | null;
  studentFilter: string | null;
  channelType: "EMAIL" | "WEBHOOK" | "IN_APP";
  channelConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

const BLANK: Omit<CaptureTrigger, "id" | "createdAt" | "profile"> = {
  profileId: null, documentTypeFilter: null, studentFilter: null,
  channelType: "EMAIL", channelConfig: {}, enabled: true,
};

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<CaptureTrigger[]>([]);
  const [profiles, setProfiles] = useState<CaptureProfile[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [configRaw, setConfigRaw] = useState("{}");
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [t, p] = await Promise.all([
      fetch("/api/capture/triggers").then((r) => r.json()),
      fetch("/api/capture/profiles").then((r) => r.json()),
    ]);
    setTriggers(Array.isArray(t) ? t : []);
    setProfiles(Array.isArray(p) ? p : []);
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm(BLANK); setConfigRaw("{}"); setEditId(null); setShowModal(true);
  }

  function openEdit(t: CaptureTrigger) {
    setForm({ profileId: t.profileId, documentTypeFilter: t.documentTypeFilter,
      studentFilter: t.studentFilter, channelType: t.channelType,
      channelConfig: t.channelConfig, enabled: t.enabled });
    setConfigRaw(JSON.stringify(t.channelConfig, null, 2));
    setEditId(t.id); setShowModal(true);
  }

  async function save() {
    setSaving(true);
    try {
      let cfg = {};
      try { cfg = JSON.parse(configRaw); } catch { /* invalid json */ }
      const body = { ...form, channelConfig: cfg };
      const url = editId ? `/api/capture/triggers/${editId}` : "/api/capture/triggers";
      await fetch(url, { method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setShowModal(false); load();
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this trigger?")) return;
    await fetch(`/api/capture/triggers/${id}`, { method: "DELETE" });
    load();
  }

  async function toggle(t: CaptureTrigger) {
    await fetch(`/api/capture/triggers/${t.id}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }) });
    load();
  }

  const CHANNEL_BADGE = { EMAIL: "bg-blue-100 text-blue-700", WEBHOOK: "bg-purple-100 text-purple-700", IN_APP: "bg-green-100 text-green-700" };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Capture Notification Triggers</h1>
        <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          + New Trigger
        </button>
      </div>

      {triggers.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No triggers configured</div>
      ) : (
        <div className="space-y-2">
          {triggers.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${CHANNEL_BADGE[t.channelType]}`}>
                {t.channelType}
              </span>
              <div className="flex-1 text-sm space-y-0.5">
                <div className="flex gap-2 text-gray-700">
                  {t.profile ? <span>Profile: <b>{t.profile.name}</b></span> : <span className="text-gray-400">Any profile</span>}
                  {t.documentTypeFilter && <span>· Type: <b>{t.documentTypeFilter}</b></span>}
                  {t.studentFilter && <span>· Student: <code className="text-xs">{t.studentFilter}</code></span>}
                </div>
                <div className="text-xs text-gray-400">{JSON.stringify(t.channelConfig)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggle(t)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.enabled ? "bg-blue-600" : "bg-gray-200"}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${t.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <button onClick={() => openEdit(t)} className="text-xs text-blue-600 hover:underline">Edit</button>
                <button onClick={() => del(t.id)} className="text-xs text-red-500 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">{editId ? "Edit Trigger" : "New Trigger"}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Profile (blank = any)</label>
                <select className="w-full border rounded px-3 py-2 text-sm"
                  value={form.profileId || ""} onChange={(e) => setForm({ ...form, profileId: e.target.value || null })}>
                  <option value="">Any profile</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Document type filter</label>
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. TRANSCRIPT"
                    value={form.documentTypeFilter || ""} onChange={(e) => setForm({ ...form, documentTypeFilter: e.target.value || null })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Student filter (regex)</label>
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. ^SCH/2024"
                    value={form.studentFilter || ""} onChange={(e) => setForm({ ...form, studentFilter: e.target.value || null })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Channel</label>
                <select className="w-full border rounded px-3 py-2 text-sm"
                  value={form.channelType} onChange={(e) => setForm({ ...form, channelType: e.target.value as "EMAIL" | "WEBHOOK" | "IN_APP" })}>
                  <option value="EMAIL">Email</option>
                  <option value="WEBHOOK">Webhook</option>
                  <option value="IN_APP">In-App notification</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Channel config (JSON)
                  <span className="text-gray-400 font-normal ml-2">
                    {form.channelType === "EMAIL" ? '— e.g. {"emails":["admin@example.com"]}' : form.channelType === "WEBHOOK" ? '— e.g. {"url":"https://..."}' : '— e.g. {"userIds":["user_id"]}'}
                  </span>
                </label>
                <textarea className="w-full border rounded px-3 py-2 text-sm font-mono h-24"
                  value={configRaw} onChange={(e) => setConfigRaw(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
