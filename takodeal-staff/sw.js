const CACHE_NAME = 'takodeal-staff-v2-payroll-schedule';
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(['/', '/index.html', '/logo.jpg', '/payroll-safety.js']);
    }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key === 'takodeal-v1' || (key.startsWith('takodeal-staff-v') && key !== CACHE_NAME)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
