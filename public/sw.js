/* ظ†ط¨ط±ط§ط³ â€” Service Worker ظ„ظ„طھط«ط¨ظٹطھ ظˆط§ظ„ط¹ظ…ظ„ ط¯ظˆظ† ط§طھطµط§ظ„ */
const CACHE_NAME = 'nibras-v19';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './logo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.pathname.indexOf('xlsx.full.min.js') >= 0) return;

  const isDocument = req.mode === 'navigate' || req.headers.get('accept').indexOf('text/html') === 0;
  if (isDocument) {
    // index.html ط¯ط§ط¦ظ…ظ‹ط§ ظ…ظ† ط§ظ„ط´ط¨ظƒط© (ظ…ط¹ ط§ظ„ط³ظ‚ظˆط· ط¥ظ„ظ‰ ط§ظ„ط®ط¨ط·ط© ط¹ظ†ط¯ ط§ظ†ظ‚ط·ط§ط¹ ط§ظ„ظ†طھ) â€” ظ„ط§ طھظˆط¬ط¯ ظ†ط³ط®ط© ظ‚ط¯ظٹظ…ط© ط¹ط§ظ„ظ‚ط©
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

