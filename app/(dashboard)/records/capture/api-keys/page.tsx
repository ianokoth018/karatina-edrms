"use client";

import { useState, useEffect } from "react";

interface ApiKey {
  id: string;
  name: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("capture");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/capture/api-keys");
    const data = await res.json();
    setKeys(Array.isArray(data) ? data : []);
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/capture/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope }),
      });
      if (!res.ok) { alert((await res.json()).error); return; }
      const data = await res.json();
      setNewKey(data.key);
      setName(""); setScope("capture");
      load();
    } finally { setSaving(false); }
  }

  async function revoke(id: string, keyName: string) {
    if (!confirm(`Revoke key "${keyName}"? This cannot be undone.`)) return;
    await fetch(`/api/capture/api-keys/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-gray-500 mt-0.5">Keys for the capture ingest endpoint (<code>/api/capture/ingest</code>)</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          + Generate Key
        </button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Key name</label>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. student-portal-prod"
                value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scope</label>
              <select className="w-full border rounded px-3 py-2 text-sm"
                value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="capture">capture</option>
                <option value="integration">integration</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={saving || !name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Generating..." : "Generate"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded text-sm hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {newKey && (
        <div className="border border-green-300 bg-green-50 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-green-800">Key generated — copy it now, it will not be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono break-all">{newKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKey); }}
              className="px-3 py-2 border rounded text-sm hover:bg-white whitespace-nowrap">Copy</button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-green-600 underline">Dismiss</button>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No active API keys</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Scope</th>
              <th className="pb-2 font-medium">Created</th>
              <th className="pb-2 font-medium">Last used</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-gray-50">
                <td className="py-3 font-medium">{k.name}</td>
                <td className="py-3 text-gray-500">{k.scope}</td>
                <td className="py-3 text-gray-500">{new Date(k.createdAt).toLocaleDateString()}</td>
                <td className="py-3 text-gray-500">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}</td>
                <td className="py-3 text-right">
                  <button onClick={() => revoke(k.id, k.name)} className="text-red-500 hover:underline text-xs">Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
