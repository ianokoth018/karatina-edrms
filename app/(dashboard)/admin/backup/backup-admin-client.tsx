"use client";

import { useCallback, useEffect, useState } from "react";

interface BackupEntry {
  id: string;
  timestamp: string;
  type: string;
  dbDumpPath: string | null;
  uploadsPath: string | null;
  dbBytes: string | null;
  uploadsBytes: string | null;
  durationMs: number;
  status: string;
  error: string | null;
}

interface Props {
  initialEntries: BackupEntry[];
}

function formatBytes(s: string | null): string {
  if (!s) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

function statusBadge(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "bg-green-100 text-green-800";
    case "RUNNING":
      return "bg-blue-100 text-blue-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function BackupAdminClient({ initialEntries }: Props) {
  const [entries, setEntries] = useState<BackupEntry[]>(initialEntries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/backup/list");
      if (!res.ok) return;
      const data = (await res.json()) as { entries: BackupEntry[] };
      setEntries(data.entries);
    } catch {
      /* silent — next poll will retry */
    }
  }, []);

  // Poll while anything is RUNNING so the table reflects completion
  // without a manual refresh. Polls slow down to 10s once nothing is
  // outstanding.
  useEffect(() => {
    const hasRunning = entries.some((e) => e.status === "RUNNING");
    const interval = hasRunning ? 3000 : 10000;
    const timer = setInterval(refresh, interval);
    return () => clearInterval(timer);
  }, [entries, refresh]);

  async function runNow() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/admin/backup/run", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { backupLogId: string };
        setInfo(
          `Backup started (id ${data.backupLogId}). Refreshing log…`
        );
        await refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 className="font-medium">Recent backups</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={runNow}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Run backup now"}
          </button>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
          {error}
        </div>
      )}
      {info && (
        <div className="px-4 py-2 text-sm text-blue-700 bg-blue-50 border-b border-blue-100">
          {info}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">DB size</th>
              <th className="px-4 py-2 text-right">Uploads size</th>
              <th className="px-4 py-2 text-right">Duration</th>
              <th className="px-4 py-2 text-left">Download</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                  No backups yet. Click <strong>Run backup now</strong> to
                  create one.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-2">{e.type}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(
                      e.status
                    )}`}
                  >
                    {e.status}
                  </span>
                  {e.error && (
                    <div
                      className="mt-1 text-xs text-red-600 truncate max-w-xs"
                      title={e.error}
                    >
                      {e.error}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatBytes(e.dbBytes)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatBytes(e.uploadsBytes)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatDuration(e.durationMs)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {e.status === "SUCCESS" && e.dbDumpPath && (
                    <a
                      href={`/api/admin/backup/download/${e.id}?artefact=db`}
                      className="text-blue-600 hover:underline mr-3"
                    >
                      DB
                    </a>
                  )}
                  {e.status === "SUCCESS" && e.uploadsPath && (
                    <a
                      href={`/api/admin/backup/download/${e.id}?artefact=uploads`}
                      className="text-blue-600 hover:underline"
                    >
                      Uploads
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
