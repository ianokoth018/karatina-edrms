"use client";

import { useEffect, useState } from "react";

/**
 * Client-side feature-flag hook.
 *
 * Mirrors the payload of `GET /api/system/features`. The fetch is
 * de-duplicated at module scope so multiple components that mount at
 * roughly the same time share a single request — important on pages
 * with both a header and a content gate.
 */

export interface SystemFeatures {
  sso: boolean;
  aiEnabled: boolean;
  aiProvider: string | null;
  webhookSigning: boolean;
  branding: { orgName: string };
}

const DEFAULT_FEATURES: SystemFeatures = {
  sso: false,
  aiEnabled: false,
  aiProvider: null,
  webhookSigning: false,
  branding: { orgName: "" },
};

let cached: SystemFeatures | null = null;
let inflight: Promise<SystemFeatures> | null = null;
// Subscribers waiting for the first fetch to land. Re-renders happen
// when each setter is called after the promise resolves.
const subscribers = new Set<(f: SystemFeatures) => void>();

async function fetchFeatures(): Promise<SystemFeatures> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/system/features", {
        // Capabilities change rarely; ok to cache aggressively in the
        // tab. We don't add HTTP cache headers because misconfiguration
        // fixes (env edits) should be visible on next page load.
        cache: "no-store",
      });
      if (!res.ok) {
        cached = DEFAULT_FEATURES;
      } else {
        cached = (await res.json()) as SystemFeatures;
      }
    } catch {
      // Network failure → fail closed.
      cached = DEFAULT_FEATURES;
    }
    for (const sub of subscribers) sub(cached);
    return cached;
  })();

  return inflight;
}

export function useFeatures(): {
  features: SystemFeatures;
  loading: boolean;
} {
  const [features, setFeatures] = useState<SystemFeatures>(
    cached ?? DEFAULT_FEATURES,
  );
  const [loading, setLoading] = useState<boolean>(cached === null);

  useEffect(() => {
    if (cached) {
      setFeatures(cached);
      setLoading(false);
      return;
    }

    let active = true;
    const onResolve = (f: SystemFeatures) => {
      if (!active) return;
      setFeatures(f);
      setLoading(false);
    };
    subscribers.add(onResolve);
    fetchFeatures().then(onResolve);

    return () => {
      active = false;
      subscribers.delete(onResolve);
    };
  }, []);

  return { features, loading };
}
