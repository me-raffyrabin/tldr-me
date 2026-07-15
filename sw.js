/* TLDR Me service worker.
 *
 * Its main job is to make the app installable — Chrome only fires
 * beforeinstallprompt for a page controlled by a worker with a fetch handler.
 * Beyond that it caches the app shell so a home-screen launch works offline.
 *
 * The model weights are NOT cached here. WebLLM and Transformers.js manage
 * their own caches (Cache API / IndexedDB); duplicating hundreds of megabytes
 * into this cache would be wasteful and would fight their eviction logic.
 */

const CACHE = 'tldrme-shell-v7';
const SHELL = [
  './',
  './index.html',
  './reader-fetch.js',
  './trust-engine.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // CDN + reader proxies: always live

  // Network-first, so a deployed update is picked up immediately; fall back to
  // the cached shell when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
