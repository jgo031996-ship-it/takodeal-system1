const CACHE_NAME = 'takodeal-manager-core-v7-stock-spaces';
const IMAGE_CACHE = 'takodeal-manager-images-v1';
const CORE_ASSETS = ['./', './index.html', './main.js', './pos-safety.js', './recipe-integrity.js', './live-report.js', './firebase-core.js', './auth.js', './style.css', './manifest.json'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
        await cache.addAll(CORE_ASSETS);
        await Promise.all(['./logo.jpg', './payslip%20logo.jpg'].map(asset => cache.add(asset).catch(() => {})));
        await self.skipWaiting();
    }));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('takodeal-manager-core-') && key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) return;

    if (request.destination === 'image') {
        event.respondWith((async () => {
            const cached = await caches.match(request, { ignoreSearch: true });
            if (cached) return cached;
            try {
                const response = await fetch(request);
                if (response.ok || response.type === 'opaque') {
                    const cache = await caches.open(IMAGE_CACHE);
                    await cache.put(request, response.clone()).catch(() => {});
                }
                return response;
            } catch {
                return new Response('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="150" fill="#f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#94a3b8">No Image</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });
        const refresh = fetch(request).then(async response => {
            if (response.ok || response.type === 'opaque') await cache.put(request, response.clone()).catch(() => {});
            return response;
        }).catch(() => cached || new Response('This file is not available offline yet.', { status: 503 }));
        if (cached) {
            event.waitUntil(refresh.then(() => {}));
            return cached;
        }
        return refresh;
    })());
});
