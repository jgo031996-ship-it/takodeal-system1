// 🔥 Unique cache names so it NEVER collides with the Cashier POS!
const CACHE_NAME = 'takodeal-manager-core-v2'; 
const IMAGE_CACHE = 'takodeal-manager-images-v1';

// The core files needed to boot the Manager UI instantly
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/main.js',
    '/style.css',
    '/logo.jpg',
    '/manifest.json',
    '/payslip%20logo.jpg' // Extremely important so your COE and Payslip generator work offline!
];

self.addEventListener('install', (event) => {
    // Save the Manager UI files to the hard drive on install!
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS);
        })
    );
    self.skipWaiting(); // Forces the browser to install immediately
});

self.addEventListener('activate', (event) => {
    // Clean out any old caches to save tablet memory
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE)
                    .map(key => caches.delete(key))
            );
        })
    );
    event.waitUntil(clients.claim()); // Takes control instantly
});

// 🔥 THE LIGHTNING FAST INTERCEPTOR
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 📸 1. AGGRESSIVE IMAGE CACHING (Staff IDs, Waste Photos, Payslips)
    if (event.request.destination === 'image' || url.hostname.includes('firebasestorage.googleapis.com')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse; // Load instantly from memory!
                }
                
                return fetch(event.request).then((networkResponse) => {
                    return caches.open(IMAGE_CACHE).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }).catch(() => {
                    // Fallback gray box if the internet is completely dead
                    return new Response('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="150" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#94a3b8">No Image</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
                });
            })
        );
        return;
    }

    // ⚡ 2. CORE APP FILES (Stale-While-Revalidate Engine)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // A. Always fetch the newest code from Vercel in the background
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                return networkResponse;
            }).catch(() => {
                // Ignore network errors on bad Wi-Fi
            });

            // B. BUT return the cached version IMMEDIATELY to the screen so it loads lightning fast
            return cachedResponse || fetchPromise;
        })
    );
});
