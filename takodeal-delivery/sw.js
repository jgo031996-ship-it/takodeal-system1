const CACHE_NAME = 'rider-app-v3-mobile-approval-20261009';
const urlsToCache = [
  './',
  './index.html',
  './main.js',
  './Delivery.jpg',
  './manifest.json',
  './rider-mobile.css',
  './rider-layout.js',
  './rider-account-model.js',
  './rider-account.js',
  './rider-dispatch-view.js',
  './rider-delivery-safety.js'
];

// Install the service worker and cache the files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate only after the previous app has closed. Never cache business or auth traffic.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('rider-app-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), root = new URL('./', self.location.href);
  if (event.request.method !== 'GET' || url.origin !== root.origin) return;
  const staticPaths = urlsToCache.map(path => new URL(path, root).pathname);
  if (!staticPaths.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
      return response;
    } catch {
      return await cache.match(event.request, { ignoreSearch: true }) || Response.error();
    }
  })());
});

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());});
