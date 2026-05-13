"use client";

import { useEffect, useRef, useState } from "react";

interface UserOption {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
}

interface RoleOption {
  id: string;
  name: string;
}

interface RecipientPickerProps {
  /** Picker kind drives the search endpoint + the stored value semantics. */
  kind: "user" | "role";
  /** The stored value — userId for "user", role name for "role". */
  value: string;
  /** Optional pre-fetched display name (rendered until results override). */
  displayName?: string;
  onChange: (value: string, displayName: string) => void;
  placeholder?: string;
}

/**
 * Search-and-select recipient picker used by the email node (and reusable
 * for other workflow-builder fields). Debounces against /api/users/search
 * or /api/admin/roles depending on `kind`.
 *
 * Stores `userId` for user-kind and role `name` for role-kind, matching
 * what the engine resolves at runtime.
 */
export default function RecipientPicker({
  kind,
  value,
  displayName,
  onChange,
  placeholder,
}: RecipientPickerProps) {
  const [query, setQuery] = useState(displayName ?? "");
  const [results, setResults] = useState<(UserOption | RoleOption)[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync query when an external value/display name change comes in.
  useEffect(() => {
    if (displayName && displayName !== query) setQuery(displayName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as globalThis.Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function runSearch(q: string) {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          kind === "user"
            ? `/api/users/search?q=${encodeURIComponent(q.trim())}&limit=8`
            : `/api/admin/roles?q=${encodeURIComponent(q.trim())}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setResults(
            kind === "user" ? (data.users ?? []) : (data.roles ?? [])
          );
        }
      } catch {
        // ignore — leave results empty
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(item: UserOption | RoleOption) {
    if (kind === "user") {
      const u = item as UserOption;
      const label = u.displayName || u.name || u.email || u.id;
      onChange(u.id, label);
      setQuery(label);
    } else {
      const r = item as RoleOption;
      onChange(r.name, r.name);
      setQuery(r.name);
    }
    setOpen(false);
    setResults([]);
  }

  function clear() {
    onChange("", "");
    setQuery("");
    setResults([]);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            runSearch(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            placeholder ??
            (kind === "user" ? "Search by name or email…" : "Search roles…")
          }
          className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 pr-8 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20"
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
            title="Clear"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && (results.length > 0 || loading) && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {loading && (
            <li className="px-3 py-2 text-xs italic text-gray-400">Searching…</li>
          )}
          {!loading &&
            results.map((item) => {
              if (kind === "user") {
                const u = item as UserOption;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => pick(u)}
                      className="flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left hover:bg-karu-green/10"
                    >
                      <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                        {u.displayName || u.name || u.email || u.id}
                      </span>
                      {u.email && (
                        <span className="text-[10px] text-gray-500">
                          {u.email}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }
              const r = item as RoleOption;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full items-center px-3 py-1.5 text-left hover:bg-karu-green/10"
                  >
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                      {r.name}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}

      {value && (
        <p className="mt-1 text-[10px] text-gray-500">
          Stored:{" "}
          <code className="font-mono text-karu-green">{value}</code>
        </p>
      )}
    </div>
  );
}
