/*
 * Service worker = a small helper the phone keeps around so the app opens offline.
 *
 * Strategy: "network first, cache as backup".
 *  - Online:  always fetch the newest version (so updates show up right away),
 *             and save a copy.
 *  - Offline: serve the saved copy.
 * Your workout data lives in the phone's database, not here; this only stores the app's files.
 */
const CACHE = 'lift-log-v2';

self.addEventListener('install', (event) => {
  // Save the start page immediately, then take over without waiting.
  event.waitUntil(caches.open(CACHE).then((c) => c.add('./')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions of this file, then control open pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Speech engine files from the jsDelivr CDN never change for a given version,
  // so keep a copy and use it first (lets on-device speech work offline).
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Only handle our own files otherwise (the speech model itself is cached by its library).
  if (url.origin !== self.location.origin) return;

  // For the page itself and version.json, skip the phone's HTTP cache (GitHub lets
  // phones reuse old copies for 10 minutes) so new versions show up right away.
  const fresh = req.mode === 'navigate' || req.url.endsWith('version.json');
  event.respondWith(
    fetch(req, fresh ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        // Page navigation while offline → fall back to the saved start page.
        if (req.mode === 'navigate') return caches.match('./');
        return Response.error();
      }),
  );
});
