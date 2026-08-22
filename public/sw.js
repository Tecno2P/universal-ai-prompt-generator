// Service Worker for Universal AI Prompt Generator PWA
const CACHE_NAME = 'prompt-gen-v3'
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Only handle GET
  if (event.request.method !== 'GET') return

  // Network-first for ALL requests — always fetch fresh from server, fall back to cache if offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful same-origin responses for offline use
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {})
        }
        return response
      })
      .catch(() => {
        // Offline — try cache, then fallback to index.html for navigation
        return caches.match(event.request).then((cached) => {
          if (cached) return cached
          if (event.request.mode === 'navigate') return caches.match('./index.html')
          throw new Error('No cached response available')
        })
      })
  )
})
