// Bumped to v5 to force the tablet to replace the crashing engine!
const CACHE_NAME = 'takodeal-pos-core-v10'; 
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
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE).map(key => caches.delete(key))
        ))
    );
    event.waitUntil(clients.claim()); 
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 🚨 THE CRASH FIX: FIREBASE DATABASE BYPASS
    // If the request is going to the live database or auth servers, do NOT touch it!
    if (event.request.method !== 'GET' || url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) {
        return; // Let the live database talk to the cloud normally!
    }

    // 📸 1. IMAGES
    if (event.request.destination === 'image' || url.hostname.includes('firebasestorage')) {
        event.respondWith(
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

    // ⚡ 2. CORE FILES
    event.respondWith(
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
