const CACHE_NAME = 'takodeal-pos-core-v1';
const IMAGE_CACHE = 'takodeal-image-storage-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Forces the tablet to install the new engine immediately
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim()); // Takes control of the app instantly
});

// 🔥 THE OFFLINE INTERCEPTOR
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 📸 AGGRESSIVE IMAGE CACHING (Saves Firebase Images to Tablet Hard Drive)
    if (event.request.destination === 'image' || url.hostname.includes('firebasestorage.googleapis.com')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                // 1. If the tablet already has the image saved, LOAD IT INSTANTLY!
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                // 2. If it's a new image, download it from Firebase...
                return fetch(event.request).then((networkResponse) => {
                    // ...and permanently save it to the tablet!
                    return caches.open(IMAGE_CACHE).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }).catch(() => {
                    // 3. Fallback: If offline and image isn't saved, show a blank gray box instead of crashing.
                    return new Response('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="150" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#94a3b8">No Image</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
                });
            })
        );
        return;
    }

    // Standard Network-First for other files
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
