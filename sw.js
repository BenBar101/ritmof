const CACHE_NAME = 'ritmol-v1';

// Use registration scope so cached URLs match the app's base path (e.g. GitHub Pages /repo/).
function getStaticAssets() {
  const base = self.registration?.scope || self.location.origin + '/';
  return [base, base + 'index.html'];
}

self.addEventListener('install', (e) => {
  const STATIC_ASSETS = getStaticAssets();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('generativelanguage.googleapis.com')) return;
  if (e.request.url.includes('googleapis.com')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
