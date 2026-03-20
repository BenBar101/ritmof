// sw.js — RITMOL service worker
// Strategy: network-first for navigation + same-origin assets.
// Cache is only used as an offline fallback, never as the primary response.
//
// CACHE_VERSION must be bumped on every deploy that changes JS/HTML/CSS.
// The build pipeline (vite.config.js) injects the real value at build time;
// the fallback string here is overwritten by the sw-cache-version plugin.
const CACHE_VERSION = self.__RITMOL_CACHE_VERSION__ || "v__BUILD_HASH__";
const CACHE_NAME = `ritmol-shell-${CACHE_VERSION}`;

// Assets pre-cached on install for offline use.
// index.html is intentionally NOT pre-cached — it must always come from the
// network so chunk hashes stay in sync with the SW version. Caching it causes
// the "Incorrect contents fetched" error when a new deploy changes JS filenames
// but the old SW serves the stale HTML referencing the old hashes.
const PRECACHE_URLS = [
  "./",
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate: prune stale caches, then tell all clients to reload ─────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() =>
        // After claiming clients, send a reload signal to every open tab.
        // This ensures stale tabs load the new JS/CSS instead of mixing old
        // cached assets with the newly deployed HTML.
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: "SW_UPDATED" });
          });
        })
      )
  );
});

// ── Fetch: network-first; never serve cached HTML for navigation ──────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests (page loads): always go to the network.
  // Never return a cached index.html — stale HTML + new JS chunks = broken app.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        // Offline fallback: serve cached "./" shell if available
        caches.match("./").then(
          (cached) =>
            cached ||
            new Response("Offline — open RITMOL when you have a connection.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        )
      )
    );
    return;
  }

  // All other GET requests (JS, CSS, fonts, etc.): network-first, cache fallback.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse.ok || networkResponse.type === "opaque") {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            new Response("Offline — open RITMOL when you have a connection.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        )
      )
  );
});
