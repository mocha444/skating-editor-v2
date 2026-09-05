/* Skating Editor service worker — lean, dependency-free.
 * Caching policy:
 *  - App shell (navigation): network-first, falls back to cached "/" for offline.
 *  - Hashed build assets under /_next/static/: cache-first (immutable).
 *  - Everything else (APIs, user videos, results, uploads): network-only.
 */
const CACHE = "skating-editor-v1";
const PRECACHE = ["/"];
const OFFLINE_ROUTE = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // User data and APIs must never be cached.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads") ||
    url.pathname.startsWith("/results") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png"
  ) {
    return;
  }

  // Navigation: network-first with cached app-shell fallback (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(OFFLINE_ROUTE, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(OFFLINE_ROUTE).then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Hashed, immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
      )
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});