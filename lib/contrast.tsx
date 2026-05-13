"use client";

// Contrast mode provider for EDRMS (KCAA accessibility spec).
// - Mirrors lib/i18n/index.tsx: client context + localStorage rehydrate.
// - SSR-safe: server render uses the default ("normal") mode; the provider
//   re-reads the stored choice on mount and updates the
//   `document.documentElement.dataset.contrast` attribute.
// - Respects OS `prefers-contrast: more` on first visit unless the user has
//   explicitly chosen a mode (i.e. nothing in localStorage yet).
// - No dependencies; the actual visual rules live in app/globals.css under
//   the `:root[data-contrast="high"]` selector.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ContrastMode = "normal" | "high";

const STORAGE_KEY = "edrms.contrast";
const DEFAULT_MODE: ContrastMode = "normal";

interface ContrastContextValue {
  mode: ContrastMode;
  setMode: (next: ContrastMode) => void;
}

const ContrastContext = createContext<ContrastContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {
    /* no-op default — overridden by provider */
  },
});

function isContrastMode(value: unknown): value is ContrastMode {
  return value === "normal" || value === "high";
}

function applyToDocument(mode: ContrastMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.contrast = mode;
}

export function ContrastProvider({ children }: { children: React.ReactNode }) {
  // Keep first render identical between server and client to avoid hydration
  // mismatches; we rehydrate from localStorage / media query in an effect.
  const [mode, setModeState] = useState<ContrastMode>(DEFAULT_MODE);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let initial: ContrastMode = DEFAULT_MODE;
    let userChose = false;

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isContrastMode(stored)) {
        initial = stored;
        userChose = true;
      }
    } catch {
      // localStorage may be unavailable (e.g. disabled cookies); fall through.
    }

    // No explicit choice yet → respect the OS preference.
    if (!userChose) {
      try {
        if (window.matchMedia("(prefers-contrast: more)").matches) {
          initial = "high";
        }
      } catch {
        // matchMedia not supported in some test environments — ignore.
      }
    }

    setModeState(initial);
    applyToDocument(initial);

    // Live-update if the OS preference flips while the app is open AND the
    // user hasn't pinned a choice.
    let mql: MediaQueryList | null = null;
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        // ignore
      }
      const next: ContrastMode = e.matches ? "high" : "normal";
      setModeState(next);
      applyToDocument(next);
    };
    try {
      mql = window.matchMedia("(prefers-contrast: more)");
      mql.addEventListener("change", onChange);
    } catch {
      mql = null;
    }
    return () => {
      if (mql) mql.removeEventListener("change", onChange);
    };
  }, []);

  const setMode = useCallback((next: ContrastMode) => {
    setModeState(next);
    applyToDocument(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // best-effort persistence
    }
  }, []);

  const value = useMemo<ContrastContextValue>(
    () => ({ mode, setMode }),
    [mode, setMode]
  );

  return (
    <ContrastContext.Provider value={value}>
      {children}
    </ContrastContext.Provider>
  );
}

export function useContrastMode(): ContrastContextValue {
  return useContext(ContrastContext);
}
