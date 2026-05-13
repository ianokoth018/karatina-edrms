"use client";

import { useEffect, useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface Sequence {
  id: string;
  name: string;
  prefix: string;
  pad: number;
  nextValue: number;
  description: string | null;
  _count: { productions: number };
  createdAt: string;
}

interface Production {
  id: string;
  name: string;
  startNumber: number;
  endNumber: number | null;
  documentCount: number;
  pageCount: number;
  sequence: { name: string; prefix: string; pad: number };
  createdAt: string;
}

export default function BatesAdminPage() {
  const { can, ready } = usePermissions();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New sequence form
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [newPad, setNewPad] = useState(6);
  const [saving, setSaving] = useState(false);

  // Run production form
  const [runSequenceId, setRunSequenceId] = useState("");
  const [runName, setRunName] = useState("");
  const [runDocumentIds, setRunDocumentIds] = useState("");
  const [running, setRunning] = useState(false);

  function refresh() {
    setLoading(true);
    Promise.all([
      fetch("/api/bates/sequences").then((r) => r.json()),
      fetch("/api/bates/productions").then((r) => r.json()),
    ])
      .then(([s, p]) => {
        setSequences(s.sequences ?? []);
        setProductions(p.productions ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    if (ready && can("admin:manage")) refresh();
  }, [ready, can]);

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage"))
    return <div className="p-6 text-red-600">Forbidden</div>;

  async function createSequence() {
    if (!newName.trim() || !newPrefix.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bates/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, prefix: newPrefix, pad: newPad }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewName("");
      setNewPrefix("");
      setNewPad(6);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function runProduction() {
    if (!runSequenceId || !runName.trim()) return;
    const ids = runDocumentIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setError("Paste at least one document ID");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/bates/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequenceId: runSequenceId,
          name: runName,
          documentIds: ids,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setRunName("");
      setRunDocumentIds("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Bates numbering</h1>
        <p className="mt-1 text-sm text-gray-600">
          Sequential page identifiers stamped on PDF copies for legal
          productions. Create a sequence, then run a production to stamp a
          set of documents.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Sequences */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Sequences
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g. KCAA-2026)"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            />
            <input
              value={newPrefix}
              onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
              placeholder="Prefix (KCAA)"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm font-mono uppercase"
            />
            <input
              type="number"
              min={3}
              max={10}
              value={newPad}
              onChange={(e) => setNewPad(parseInt(e.target.value) || 6)}
              placeholder="Pad"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            />
            <button
              onClick={createSequence}
              disabled={saving}
              className="h-9 rounded-md bg-karu-green px-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Creating…" : "+ New sequence"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1.5">Name</th>
                <th>Prefix</th>
                <th>Next #</th>
                <th>Productions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-400 italic">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && sequences.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-400 italic">
                    No sequences yet.
                  </td>
                </tr>
              )}
              {sequences.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 font-medium">{s.name}</td>
                  <td className="font-mono">{s.prefix}</td>
                  <td className="font-mono">
                    {s.prefix}-{String(s.nextValue).padStart(s.pad, "0")}
                  </td>
                  <td>{s._count.productions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Run production */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Run a production
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={runSequenceId}
              onChange={(e) => setRunSequenceId(e.target.value)}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            >
              <option value="">— sequence —</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Production name"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            />
          </div>
          <textarea
            value={runDocumentIds}
            onChange={(e) => setRunDocumentIds(e.target.value)}
            rows={5}
            placeholder="Paste document IDs (one per line or comma-separated)"
            className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs"
          />
          <button
            onClick={runProduction}
            disabled={running}
            className="h-9 rounded-md bg-karu-green px-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {running ? "Stamping…" : "Run production"}
          </button>
        </div>
      </section>

      {/* Productions list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Productions
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th>Sequence</th>
                <th>Bates range</th>
                <th>Docs</th>
                <th>Pages</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-2 italic text-gray-400">
                    No productions yet.
                  </td>
                </tr>
              )}
              {productions.map((p) => {
                const padPrefix = `${p.sequence.prefix}-`;
                const start = `${padPrefix}${String(p.startNumber).padStart(p.sequence.pad, "0")}`;
                const end = p.endNumber
                  ? `${padPrefix}${String(p.endNumber).padStart(p.sequence.pad, "0")}`
                  : "—";
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td>{p.sequence.name}</td>
                    <td className="font-mono text-xs">
                      {start} … {end}
                    </td>
                    <td>{p.documentCount}</td>
                    <td>{p.pageCount}</td>
                    <td className="text-xs text-gray-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
