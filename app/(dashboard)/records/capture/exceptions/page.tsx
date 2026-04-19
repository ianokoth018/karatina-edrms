"use client";

import { useState, useEffect, useCallback } from "react";

interface ExceptionItem {
  id: string;
  profileId: string;
  profile: { name: string };
  filePath: string;
  extractedMetadata: Record<string, unknown>;
  errors: Array<{ field: string; reason: string }>;
  status: "PENDING" | "RESOLVED" | "REJECTED";
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS_COLORS = {
  PENDING: "bg-yellow-100 text-yellow-800",
  RESOLVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default function CaptureExceptionsPage() {
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [status, setStatus] = useState<"PENDING" | "RESOLVED" | "REJECTED">("PENDING");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/capture/exceptions?status=${status}&page=${page}`);
      const data = await res.json();
      setItems(data.items);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "resolve" | "reject") {
    await fetch(`/api/capture/exceptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Capture Exception Queue</h1>
        <div className="flex gap-2">
          {(["PENDING", "RESOLVED", "REJECTED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                status === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No {status.toLowerCase()} exceptions</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="border rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpanded(expanded === item.id ? null : item.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                      {item.status}
                    </span>
                    <span className="font-medium text-sm truncate">{item.filePath.split("/").pop()}</span>
                    <span className="text-xs text-gray-400">{item.profile.name}</span>
                  </div>
                  <div className="flex gap-3 mt-1">
                    {item.errors.map((e, i) => (
                      <span key={i} className="text-xs text-red-600">
                        <b>{e.field}</b>: {e.reason}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-xs text-gray-400 ml-4 shrink-0">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>
              {expanded === item.id && (
                <div className="px-4 pb-4 border-t bg-gray-50 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Extracted metadata</p>
                    <pre className="text-xs bg-white border rounded p-2 overflow-auto max-h-40">
                      {JSON.stringify(item.extractedMetadata, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">File path</p>
                    <code className="text-xs">{item.filePath}</code>
                  </div>
                  {item.status === "PENDING" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => act(item.id, "resolve")}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                      >
                        Mark Resolved
                      </button>
                      <button
                        onClick={() => act(item.id, "reject")}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`px-3 py-1 rounded text-sm ${
                page === i + 1 ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
