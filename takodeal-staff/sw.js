const CACHE_NAME = 'takodeal-staff-v15-private-document-broker-20261009-r1';
const SHELL = ['./', './index.html', './style.css', './staff-theme.css', './app.js', './staff-portal.js', './staff-location.js', './staff-registration.js', './staff-phone.js', './app-update.js', './staff-privacy.js', './payroll-safety.js','./schedule-history.js', './logo.jpg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './manifest.json'];
SHELL.push('./sanction-schedule.js');
SHELL.push('./attendance-reconcile.js');
SHELL.push('./staff-document-broker.js');
SHELL.push('./payroll-attendance.js');
SHELL.push('./staff-rate-privacy.js','./staff-documents.js','./staff-documents.css','./staff-document-model.js','./staff-document-store.js','./staff-document-firebase.js','./attendance-camera.js','./vendor/face-api.min.js','./vendor/face-models/tiny_face_detector_model-weights_manifest.json','./vendor/face-models/tiny_face_detector_model-shard1','./vendor/face-models/face_landmark_68_tiny_model-weights_manifest.json','./vendor/face-models/face_landmark_68_tiny_model-shard1');
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key === 'takodeal-v1' || (key.startsWith('takodeal-staff-v') && key !== CACHE_NAME)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    // Never cache staff API requests, payroll responses, or third-party traffic.
    const name = url.pathname.split('/').pop();
    if (event.request.mode !== 'navigate' && !SHELL.some(path => path.split('/').pop() === name)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const response = await fetch(event.request);
            if (response.ok) await cache.put(event.request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(event.request, { ignoreSearch:true }) || (event.request.mode === 'navigate' ? await cache.match('./index.html') : null);
            if (cached) return cached;
            throw error;
        }
    })());
});
