/* Path to Olympus — service worker.
 * App files: network first (updates show up right after you upload to GitHub),
 * falling back to the cached copy offline. Bump VERSION to force a clean cache. */
const VERSION = 'olympus-v6-3';
const SHELL = ['./', './index.html', './admin.html', './style.css', './engine.js', './core.js', './fx.js', './config.js',
  './manifest.webmanifest', './admin.webmanifest', './icons/icon-192.png', './icons/admin-192.png', './icons/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Firebase SDK files are versioned → cache first.
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return; // Firestore / Auth traffic: never touch
  if (url.pathname.includes('/media/')) return; // your images, GIFs & videos: let the browser handle them
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
