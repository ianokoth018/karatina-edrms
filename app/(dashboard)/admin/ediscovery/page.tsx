"use client";

import { useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

interface BatesStamp {
  startNumber: number;
  endNumber: number;
  production: { id: string; name: string };
}
interface DocResult {
  id: string;
  referenceNumber: string;
  title: string;
  documentType: string;
  department: string;
  createdAt: string;
  createdBy: { displayName: string; name: string };
  bates: BatesStamp[];
}

export default function EDiscoveryPage() {
  const { can, ready } = usePermissions();
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [department, setDepartment] = useState("");
  const [hasBates, setHasBates] = useState("");
  const [results, setResults] = useState<DocResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!ready) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!can("admin:manage"))
    return <div className="p-6 text-red-600">Forbidden</div>;

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (documentType.trim()) params.set("documentType", documentType.trim());
      if (department.trim()) params.set("department", department.trim());
      if (hasBates) params.set("hasBates", hasBates);
      params.set("limit", "100");
      const res = await fetch(`/api/ediscovery/search?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.documents ?? []);
      setTotal(data.pagination?.total ?? 0);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function exportLoadFile() {
    if (selected.size === 0) return;
    try {
      const res = await fetch("/api/ediscovery/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: [...selected],
          format: "concordance",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `production-${Date.now()}.dat`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">eDiscovery</h1>
        <p className="mt-1 text-sm text-gray-600">
          Cross-corpus search for legal productions. Filter, select, then
          export a Concordance load file for handoff to a review platform.
        </p>
      </header>

      <div className="rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Full-text or reference number"
          className="h-9 rounded-md border border-gray-300 px-2 text-sm md:col-span-3"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
        />
        <select
          value={hasBates}
          onChange={(e) => setHasBates(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
        >
          <option value="">All — Bates or not</option>
          <option value="true">Has Bates stamps</option>
          <option value="false">Not yet stamped</option>
        </select>
        <input
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          placeholder="Document type"
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
        />
        <input
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Department"
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="h-9 rounded-md bg-karu-green px-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {total > 0 && `${total.toLocaleString()} match${total === 1 ? "" : "es"}. `}
          {selected.size > 0 && `${selected.size} selected.`}
        </span>
        <button
          onClick={exportLoadFile}
          disabled={selected.size === 0}
          className="h-8 rounded-md bg-karu-green px-3 text-xs font-medium text-white disabled:opacity-50"
        >
          Export load file ({selected.size})
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2"></th>
              <th>Reference</th>
              <th>Title</th>
              <th>Type</th>
              <th>Dept</th>
              <th>Custodian</th>
              <th>Created</th>
              <th>Bates</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-3 italic text-gray-400">
                  No results.
                </td>
              </tr>
            )}
            {results.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={() => toggle(d.id)}
                  />
                </td>
                <td className="font-mono text-xs">{d.referenceNumber}</td>
                <td className="max-w-[260px] truncate">{d.title}</td>
                <td>{d.documentType}</td>
                <td>{d.department}</td>
                <td className="text-xs">{d.createdBy.displayName || d.createdBy.name}</td>
                <td className="text-xs text-gray-500">
                  {new Date(d.createdAt).toLocaleDateString()}
                </td>
                <td className="font-mono text-xs">
                  {d.bates.length > 0 ? d.bates[0].production.name : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
