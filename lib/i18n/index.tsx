"use client";

// Minimal client-side i18n for EDRMS.
// - No new dependencies; pure React context + localStorage.
// - SSR-safe: server render always uses the default "en" dictionary,
//   then the provider rehydrates from localStorage on mount.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import en from "./locales/en";
import sw from "./locales/sw";

export type Locale = "en" | "sw";

export const SUPPORTED_LOCALES: Locale[] = ["en", "sw"];

const STORAGE_KEY = "edrms.locale";
const DEFAULT_LOCALE: Locale = "en";

// All dictionaries share the same shape. We widen `typeof en` so other
// locales (which have different string literal values) are assignable —
// the structural key shape is what matters for translation lookup.
type Dictionary = {
  readonly [K in keyof typeof en]: {
    readonly [J in keyof (typeof en)[K]]: string;
  };
};

const dictionaries: Record<Locale, Dictionary> = {
  en,
  sw,
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {
    /* no-op default — overridden by provider */
  },
});

export { LocaleContext };

function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (SUPPORTED_LOCALES as string[]).includes(value)
  );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Always start with the default to keep server and first client render
  // identical; rehydrate from localStorage in an effect.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored) && stored !== locale) {
        setLocaleState(stored);
      }
    } catch {
      // Access to localStorage can throw (e.g. disabled cookies / SSR proxies).
      // We just stay on the default.
    }
    // We only want this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // best-effort persistence
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/**
 * Resolve a dotted key (e.g. "nav.dashboard") against the active dictionary.
 * Unknown keys fall back to the key itself in development so missing
 * translations are obvious; in production we still return the key (better
 * than rendering "undefined").
 */
function resolveKey(dict: Dictionary, key: string): string {
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof cursor === "string" ? cursor : key;
}

export function useTranslation(): {
  t: (key: string) => string;
  locale: Locale;
  setLocale: (next: Locale) => void;
} {
  const { locale, setLocale } = useContext(LocaleContext);
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];

  const t = useCallback(
    (key: string) => {
      const value = resolveKey(dict, key);
      if (value === key && process.env.NODE_ENV !== "production") {
        // Surface missing translations during development.
        // eslint-disable-next-line no-console
        console.warn(`[i18n] Missing translation for "${key}" in "${locale}"`);
      }
      return value;
    },
    [dict, locale]
  );

  return { t, locale, setLocale };
}
