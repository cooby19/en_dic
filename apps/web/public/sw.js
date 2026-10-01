/* Only the public application shell is cached. API, OAuth, exports and private data never enter CacheStorage. */
const CACHE = 'en-dic-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(async keys => { for (const key of keys) if (key.startsWith('en-dic-shell-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); }));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/'))); return;
  }
  if (!SHELL.includes(url.pathname) && !/^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response;
  })));
});
