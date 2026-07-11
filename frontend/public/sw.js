/*
 * SymptoBridge service worker.
 *
 * Strategy:
 *  - /_next/static/**  -> cache-first. Filenames are content-hashed, so a hit
 *    is immutable and safe forever.
 *  - page navigations  -> network-first with cache fallback, so deploys are
 *    picked up immediately but the app shell still opens offline.
 *  - /api/**           -> untouched. Data offline-behaviour is handled by the
 *    React Query cache persisted to IndexedDB, which understands auth and
 *    staleness in a way a blind HTTP cache cannot.
 */

const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(PAGE_CACHE).then((cache) => cache.add('/')));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts/CDNs: browser default
  if (url.pathname.startsWith('/api/')) return; // never cache API responses here

  // Immutable hashed assets: cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Page navigations: network-first, cache fallback, then cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match('/'))
        )
    );
  }
});
