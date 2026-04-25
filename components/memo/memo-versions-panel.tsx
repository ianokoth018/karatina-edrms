"use client";

import { useEffect, useState } from "react";

interface MemoVersion {
  id: string;
  versionNum: number;
  changeNote: string;
  isLatest: boolean;
  sizeBytes: number;
  createdAt: string;
  createdByName: string;
}

interface Props {
  memoId: string;
}

/**
 * Versions panel for the memo view. Lists every PDF snapshot the memo
 * has accumulated (initial submission, signing, recommendation,
 * approval, etc.) with per-row View / Download. The "Latest" badge
 * marks what Preview/Download Memo at the top of the page serves.
 */
export default function MemoVersionsPanel({ memoId }: Props) {
  const [versions, setVersions] = useState<MemoVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/memos/${memoId}/versions`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setVersions(data.versions ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memoId]);

  if (!loading && versions.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-[#02773b]/5 to-transparent">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
          </svg>
          Versions
          <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
            ({versions.length})
          </span>
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Each row is a PDF snapshot taken when the memo changed. Latest is what Preview/Download Memo serves.
        </p>
      </div>
      {loading ? (
        <div className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400">Loading…</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {versions.map((v) => (
            <li key={v.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center min-w-[2.25rem] h-6 px-2 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-mono font-semibold text-gray-700 dark:text-gray-300">
                    v{v.versionNum}
                  </span>
                  {v.isLatest && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                      Latest
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-1 break-words">
                  {v.changeNote}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {v.createdByName} ·{" "}
                  {new Date(v.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {(v.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>
              <a
                href={`/api/memos/${memoId}/versions/${v.versionNum}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                View
              </a>
              <a
                href={`/api/memos/${memoId}/versions/${v.versionNum}`}
                download={`memo.v${v.versionNum}.pdf`}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
