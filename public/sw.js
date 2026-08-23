/**
 * The service worker — the shell offline, the data never silently stale.
 *
 * ONE HARD RULE, from the design: `/api/*` is never intercepted. Not cached, not
 * network-first-with-fallback — the handler returns before respondWith, so the browser
 * talks to the server exactly as if this file did not exist. An offline READ fails
 * honestly; offline WRITES already have their story (the autosave queue holds them, the
 * drain retries, the unload beacon delivers).
 *
 * Static assets are content-hashed by the build, so cache-first can never serve a stale
 * byte — only an orphaned one, which the version bump below clears on activate.
 */

const VERSION = 'axiomate-sw-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  /* The hard rule. Everything under /api/ passes through untouched. */
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return

  /* Navigations: the network, and an honest offline page when there is none. */
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  /* Hashed build assets and the two font hosts: cache-first, filled on first use. */
  const cacheable =
    (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) ||
    (url.origin === self.location.origin && url.pathname.startsWith('/icons/')) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  if (!cacheable) return

  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            if (res.ok) cache.put(event.request, res.clone())
            return res
          }),
      ),
    ),
  )
})
