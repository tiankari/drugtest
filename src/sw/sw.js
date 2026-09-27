// Service worker template. build/sw-plugin.ts fills in the precache list and
// version after each production build. Offline-first: after the first load,
// the app runs entirely from this cache. It never contacts any other origin.

/* eslint-disable no-restricted-globals */
const PRECACHE = __PRECACHE_FILES__;
const VERSION = __CACHE_VERSION__;
const CACHE = `fdtc-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((f) => new Request(new URL(f, self.registration.scope), { cache: 'reload' }))),
    ),
  );
  // Do not skipWaiting here: the page asks the user before switching versions,
  // so an update never swaps code under an officer mid-capture.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fdtc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'SW_VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Hash routing: every navigation is the app shell.
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(new URL('./', self.registration.scope), { ignoreVary: true }).then((hit) => hit || fetch(req)),
      ),
    );
    return;
  }
  // ignoreVary: module scripts are CORS requests with an Origin header, while
  // precached responses were fetched without one; a Vary header on the cached
  // response would otherwise make every lookup miss and break offline use.
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req))),
  );
});
