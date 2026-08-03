// Bumped to v4 to force the tablet to replace the engine!
const CACHE_NAME = 'takodeal-pos-core-v4'; 
const IMAGE_CACHE = 'takodeal-image-storage-v1';

const CORE_ASSETS = [
    '/',
    '/index.html',
    '/main.js',
    '/style.css',
    '/logo.jpg',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE)
                    .map(key => caches.delete(key))
            );
        })
    );
    event.waitUntil(clients.claim()); 
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. IMAGES
    if (event.request.destination === 'image' || url.hostname.includes('firebasestorage.googleapis.com')) {
        event.respondWith(
            // 🔥 THE FIX: ignoreSearch: true forces it to ignore URL tags!
            caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                
                return fetch(event.request).then((networkResponse) => {
                    const responseToCache = networkResponse.clone();
                    caches.open(IMAGE_CACHE).then((cache) => cache.put(event.request, responseToCache));
                    return networkResponse;
                }).catch(() => {
                    return new Response('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="150" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#94a3b8">No Image</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
                });
            })
        );
        return;
    }

    // 2. CORE FILES
    event.respondWith(
        // 🔥 THE FIX: ignoreSearch: true forces it to load main.js instantly!
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                return networkResponse;
            }).catch(() => {});

            return cachedResponse || fetchPromise;
        })
    );
});
