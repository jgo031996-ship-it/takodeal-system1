const CACHE_NAME = 'rider-app-v1';
const urlsToCache = [
  './',
  './index.html',
  './main.js',
  './Delivery.jpg'
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

// Intercept network requests to keep the app fast
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version if found, otherwise fetch from internet
        return response || fetch(event.request);
      })
  );
});
