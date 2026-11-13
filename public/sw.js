/* äÈÑÇÓ — Service Worker ááÊËÈíÊ æÇáÚãá Ïæä ÇÊÕÇá */
const CACHE_NAME = 'nibras-v173';
const CORE_ASSETS = [
  './',
  './index.html',
  './toolbar.css?v=7',
  './toolbar.js?v=8',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './logo.jpg',
  './assets/nibras-school-building.png',
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
    ).then(() => self.clients.claim()).then(() =>
      // ÈÚÏ ÓíØÑÉ ÇáäÓÎÉ ÇáÌÏíÏÉ äØáÈ ãä ßá ÇáäæÇÝÐ ÅÚÇÏÉ ÇáÊÍãíá ãÑÉ æÇÍÏÉ
      // ÍÊì áÇ ÊÈÞì Ãí ÌåÇÒ íÚãá ÈãáÝÇÊ ÞÏíãÉ ãÎÒäÉ
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) =>
        clients.forEach((client) => {
          try { client.postMessage({ type: 'NEW_VERSION', version: CACHE_NAME }); } catch (_) { /* ÊÌÇåá */ }
        })
      )
    )
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
    // index.html Ø¯Ø§Ø¦Ù…Ù‹Ø§ Ù…Ù† Ø§Ù„Ø´Ø¨ÙƒØ© (Ù…Ø¹ Ø§Ù„Ø³Ù‚ÙˆØ· Ø¥Ù„Ù‰ Ø§Ù„Ø®Ø¨Ø·Ø© Ø¹Ù†Ø¯ Ø§Ù†Ù‚Ø·Ø§Ø¹ Ø§Ù„Ù†Øª) â€” Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†Ø³Ø®Ø© Ù‚Ø¯ÙŠÙ…Ø© Ø¹Ø§Ù„Ù‚Ø©
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

