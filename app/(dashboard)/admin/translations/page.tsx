"use client";

import { useCallback, useEffect, useState } from "react";
import { usePermissions } from "@/lib/use-permissions";

type Tab = "missing" | "cached" | "retranslate";

interface MissingEntry {
  key: string;
  sourceText: string;
  keyHash: string;
}

interface CachedEntry {
  id: string;
  sourceLocale: string;
  targetLocale: string;
  sourceText: string;
  targetText: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

const TARGET_LOCALE = "sw";

export default function TranslationsAdminPage() {
  const { can, ready } = usePermissions();
  const [tab, setTab] = useState<Tab>("missing");

  const allowed = can("admin:manage");

  if (!ready) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <p className="text-red-700 dark:text-red-400 font-medium">
            You do not have permission to manage translations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Translation Manager
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage Swahili translations sourced from the LLM cache. Source-of-truth
          keys still live in <code>lib/i18n/locales/*.ts</code>.
        </p>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-800 flex gap-2">
        {(
          [
            ["missing", "Missing"],
            ["cached", "Cached"],
            ["retranslate", "Re-translate"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-karu-green text-karu-green"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "missing" && <MissingTab />}
      {tab === "cached" && <CachedTab />}
      {tab === "retranslate" && <RetranslateTab />}
    </div>
  );
}

// ─── Missing tab ──────────────────────────────────────────────────────────

function MissingTab() {
  const [entries, setEntries] = useState<MissingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/translations/missing?targetLocale=${TARGET_LOCALE}`
      );
      if (res.ok) {
        const data = (await res.json()) as { missing?: MissingEntry[] };
        setEntries(data.missing ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function translateOne(entry: MissingEntry) {
    setTranslatingKey(entry.key);
    try {
      const res = await fetch("/api/admin/translations/retranslate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "selected",
          texts: [entry.sourceText],
          targetLocale: TARGET_LOCALE,
        }),
      });
      if (res.ok) {
        // Reload so the row drops out of "missing".
        await load();
      }
    } finally {
      setTranslatingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="h-32 grid place-items-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
        <p className="text-green-700 dark:text-green-400 font-medium">
          No missing Swahili translations. Everything in the source dictionary
          is either translated in <code>sw.ts</code> or cached.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/50">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500">Key</th>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500">
              English
            </th>
            <th className="text-right px-4 py-2.5 font-medium text-gray-500">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {entries.map((e) => (
            <tr key={e.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
              <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                {e.key}
              </td>
              <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">
                {e.sourceText}
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => translateOne(e)}
                  disabled={translatingKey === e.key}
                  className="px-3 py-1.5 rounded-lg bg-karu-green text-white text-xs font-medium hover:bg-karu-green-dark disabled:opacity-60"
                >
                  {translatingKey === e.key ? "Translating…" : "Translate now"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cached tab ───────────────────────────────────────────────────────────

function CachedTab() {
  const [entries, setEntries] = useState<CachedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        targetLocale: TARGET_LOCALE,
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/admin/translations/cache?${params}`);
      if (res.ok) {
        const data = (await res.json()) as {
          entries?: CachedEntry[];
          total?: number;
        };
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEdit(entry: CachedEntry) {
    setBusyId(entry.id);
    try {
      const res = await fetch(
        `/api/admin/translations/cache/${entry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetText: editText }),
        }
      );
      if (res.ok) {
        setEditingId(null);
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function retranslate(entry: CachedEntry) {
    setBusyId(entry.id);
    try {
      const res = await fetch("/api/admin/translations/retranslate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "selected",
          texts: [entry.sourceText],
          targetLocale: entry.targetLocale,
          sourceLocale: entry.sourceLocale,
        }),
      });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(entry: CachedEntry) {
    if (!confirm(`Delete cached translation for "${entry.sourceText}"?`)) {
      return;
    }
    setBusyId(entry.id);
    try {
      const res = await fetch(
        `/api/admin/translations/cache?id=${encodeURIComponent(entry.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search source or target…"
          className="h-10 w-72 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm"
        />
        <span className="text-xs text-gray-500">
          {total} cached row{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">
                Source (EN)
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">
                Target (SW)
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">
                Origin
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading && entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No cached translations.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 max-w-md">
                    {e.sourceText}
                  </td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 max-w-md">
                    {editingId === e.id ? (
                      <textarea
                        value={editText}
                        onChange={(ev) => setEditText(ev.target.value)}
                        className="w-full min-h-[60px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 text-sm"
                      />
                    ) : (
                      e.targetText
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        e.createdById
                          ? "bg-karu-gold-light text-karu-gold"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {e.createdById ? "Admin" : "AI"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {editingId === e.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(e)}
                          disabled={busyId === e.id}
                          className="px-2.5 py-1 rounded-lg bg-karu-green text-white text-xs font-medium hover:bg-karu-green-dark disabled:opacity-60 mr-1"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(e.id);
                            setEditText(e.targetText);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs mr-1 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => retranslate(e)}
                          disabled={busyId === e.id}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs mr-1 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                        >
                          Re-translate
                        </button>
                        <button
                          onClick={() => remove(e)}
                          disabled={busyId === e.id}
                          className="px-2.5 py-1 rounded-lg text-red-600 text-xs hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Re-translate tab ─────────────────────────────────────────────────────

function RetranslateTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        "Wipe every auto-translated Swahili row (admin-curated rows are preserved) and let them regenerate on demand?"
      )
    ) {
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/translations/retranslate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "all-stale",
          targetLocale: TARGET_LOCALE,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cleared?: number };
        setResult(`Cleared ${data.cleared ?? 0} cached rows.`);
      } else {
        setResult("Re-translate failed.");
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Re-translate stale entries
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Useful after editing <code>lib/i18n/locales/sw.ts</code> or the
          English source. Existing admin-curated overrides are preserved.
        </p>
      </div>
      <button
        onClick={run}
        disabled={running}
        className="px-4 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark disabled:opacity-60"
      >
        {running ? "Working…" : "Re-translate all stale entries"}
      </button>
      {result && (
        <div className="text-sm text-gray-700 dark:text-gray-300">{result}</div>
      )}
    </div>
  );
}
