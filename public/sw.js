/* Carmen service worker — caches the app shell for offline use.
   Network-first for navigation/JS so a new deploy is picked up immediately;
   cache-first fallback when offline. API routes are never cached. */
const CACHE = 'carmen-v42';
const CORE = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg'];
const API_RE = /^\/(health|search|retrieve|source|img|dive|learn|chat|analyze|synthesize)(\/|\?|$)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('carmen-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  if (API_RE.test(u.pathname)) return; // never intercept API calls
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
