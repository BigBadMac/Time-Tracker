// Time Tracker service worker.
// Strategy: network-first for everything. Online loads always get the freshly
// deployed files; the cache exists only as the offline fallback. This is what
// makes "push to GitHub -> relaunch the app -> new build" actually true.
//
// Bump CACHE_VERSION whenever this file's strategy changes - the activate
// step evicts every cache that doesn't match, so stale content from any
// previous worker generation is destroyed on takeover.
var CACHE_VERSION = 'tt-net-first-2026-08-19';

self.addEventListener('install', function (e) {
  // Take over from any previous worker immediately instead of waiting for
  // every old tab/app instance to close.
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      // Control already-open pages right away.
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      // Fresh from the network: hand it over and refresh the offline copy.
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) {
          c.put(e.request, copy).catch(function () {});
        }).catch(function () {});
      }
      return res;
    }).catch(function () {
      // Offline: serve the cached copy. ignoreSearch so ?v=... style URLs
      // still hit the cached app shell.
      return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
        if (m) return m;
        return caches.match('index.html', { ignoreSearch: true });
      });
    })
  );
});
