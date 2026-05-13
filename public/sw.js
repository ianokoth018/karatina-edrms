/* eslint-disable */
// Karatina EDRMS service worker
// Plain JS — served as-is from /public/sw.js

const CACHE_NAME = "edrms-v1";
const OFFLINE_HTML = "You are offline. Please reconnect.";

// Paths that should always hit the network (never cached).
function isBypass(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/embed/");
}

// Paths that should be cache-first (long-lived / hashed assets + icon + manifest).
function isCacheFirst(url) {
  return (
    url.pathname === "/icon.png" ||
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/_next/static/")
  );
}

self.addEventListener("install", (event) => {
  // Activate this SW as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      );
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && request.method === "GET") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidateNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Prefer fresh network for navigations; fall back to cache, then offline page.
  try {
    const fresh = await fetchPromise;
    if (fresh) return fresh;
  } catch (_) {
    // ignore — fall through to cache / offline
  }
  if (cached) return cached;
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  if (isBypass(url)) return; // let the network handle it directly

  if (isCacheFirst(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidateNavigation(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
