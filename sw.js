// Network-first so updates pushed to GitHub Pages show up right away; the cache
// is only a fallback for offline use (e.g. in bed with flaky Wi-Fi).
const CACHE = 'fluire-v8';
const FILES = ['./', 'index.html', 'styles.css', 'program.js', 'app.js', 'hrv.js', 'anchor.js', 'reflect.js', 'report.js', 'sync.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Only the app's own files: never cache Google sign-in or Drive responses.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: revalidate with the server instead of trusting the HTTP cache
    // (GitHub Pages allows 10 minutes), so a new deploy shows up at once.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
