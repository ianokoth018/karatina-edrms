"use client";

// Minimal client-side i18n for EDRMS.
// - No new dependencies; pure React context + localStorage.
// - SSR-safe: server render always uses the default "en" dictionary,
//   then the provider rehydrates from localStorage on mount.
// - LLM auto-translation: when the active locale is missing a string we
//   fall back to a module-level cache populated from `/api/i18n/translate`.
//   English text is returned synchronously so the UI never blanks; the
//   batched request fires in the background and a re-render is forced
//   when results land.

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
const SOURCE_LOCALE: Locale = "en";

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

// ─── Auto-translate cache (module-scoped, per browser tab) ────────────────
//
// `autoCache.get(locale)?.get(sourceText)` →
//   - string: translated text from `/api/i18n/translate`
//   - undefined: never requested; queue and force re-render when it arrives.
const autoCache: Map<Locale, Map<string, string>> = new Map();
function getLocaleCache(locale: Locale): Map<string, string> {
  let m = autoCache.get(locale);
  if (!m) {
    m = new Map();
    autoCache.set(locale, m);
  }
  return m;
}

// In-flight requests so we don't ask for the same string twice while a
// batch is still pending.
const inFlight: Map<Locale, Set<string>> = new Map();
function getInFlight(locale: Locale): Set<string> {
  let s = inFlight.get(locale);
  if (!s) {
    s = new Set();
    inFlight.set(locale, s);
  }
  return s;
}

// Pending batch — flushed 250ms after the last enqueue. We coalesce all
// missing strings the UI asks for during a single tick into one network
// call.
const pendingByLocale: Map<Locale, Set<string>> = new Map();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Subscribers that want a re-render when new translations arrive.
const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}

function enqueueTranslation(locale: Locale, text: string) {
  if (locale === SOURCE_LOCALE) return;
  if (getLocaleCache(locale).has(text)) return;
  if (getInFlight(locale).has(text)) return;

  let bucket = pendingByLocale.get(locale);
  if (!bucket) {
    bucket = new Set();
    pendingByLocale.set(locale, bucket);
  }
  bucket.add(text);

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, 250);
}

async function flushPending() {
  // Snapshot + clear so new enqueues during the request go into the next batch.
  const snapshot = new Map(pendingByLocale);
  pendingByLocale.clear();

  await Promise.all(
    Array.from(snapshot.entries()).map(async ([locale, set]) => {
      if (set.size === 0) return;
      const texts = Array.from(set).slice(0, 50);
      const flight = getInFlight(locale);
      texts.forEach((t) => flight.add(t));

      try {
        const res = await fetch("/api/i18n/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts,
            targetLocale: locale,
            sourceLocale: SOURCE_LOCALE,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          translations?: Record<string, string>;
        };
        const cache = getLocaleCache(locale);
        if (data.translations) {
          for (const [src, tgt] of Object.entries(data.translations)) {
            cache.set(src, tgt);
          }
        }
        notify();
      } catch {
        // Silent — UI keeps showing English; we'll retry on the next render
        // that exercises the missing key (after the in-flight entry clears).
      } finally {
        texts.forEach((t) => flight.delete(t));
      }
    })
  );

  // If anything piled up during the await above, schedule another flush.
  if (pendingByLocale.size > 0 && !flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPending();
    }, 250);
  }
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
 * Returns:
 *   - the localized string when present
 *   - `null` to signal "missing — fall back to source"
 */
function resolveKey(dict: Dictionary, key: string): string | null {
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof cursor === "string" ? cursor : null;
}

export function useTranslation(): {
  t: (key: string) => string;
  locale: Locale;
  setLocale: (next: Locale) => void;
} {
  const { locale, setLocale } = useContext(LocaleContext);
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  const sourceDict = dictionaries[SOURCE_LOCALE];

  // Bump on auto-translate arrivals so the consumer re-renders.
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const t = useCallback(
    (key: string) => {
      const localized = resolveKey(dict, key);
      if (localized !== null) return localized;

      // Missing in the target dictionary. Try the source dictionary so we
      // have a real English string to translate (rather than the dotted key).
      const sourceText =
        locale === SOURCE_LOCALE ? null : resolveKey(sourceDict, key);

      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] Missing translation for "${key}" in "${locale}"`);
      }

      if (sourceText === null) {
        // Truly unknown key — return the key so it's obvious in the UI.
        return key;
      }

      // English fallback already? Nothing more to do.
      if (locale === SOURCE_LOCALE) return sourceText;

      const cached = getLocaleCache(locale).get(sourceText);
      if (cached) return cached;

      // Queue and return the source so the UI keeps rendering.
      enqueueTranslation(locale, sourceText);
      return sourceText;
    },
    [dict, sourceDict, locale]
  );

  return { t, locale, setLocale };
}
