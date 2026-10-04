const CACHE_NAME = 'takodeal-manager-core-v21-device-recovery';
const VENDOR_CACHE = 'takodeal-manager-vendors-v1';
const IMAGE_CACHE = 'takodeal-manager-images-v1';
const CORE_ASSETS = ['./', './index.html', './main.js', './device-fleet.js', './app-update.js', './employee-id.js', './employee-id.css', './payslip.css', './schedule-layout.js', './request-history.js', './schedule-layout.css', './login.css', './login-ui.js', './unlock-gate.js', './device-store.js', './manager-libraries.js', './branch-operations.js', './cash-settlement.js', './shift-close-ui.js', './collection-cache.js', './manager-dialogs.js', './manager-workspace.js', './manager-workspace.css', './dispatch-safety.js', './menu-bulk.js', './pos-safety.js', './recipe-integrity.js', './live-report.js', './payroll-safety.js', './dashboard.js', './dashboard-data.js', './dashboard.css', './manager-theme.css', './manager-theme.js', './firebase-core.js', './auth.js', './style.css', './manifest.json'];
const VENDORS = [
    ...['app','auth','firestore','storage'].map(name => `https://www.gstatic.com/firebasejs/10.8.1/firebase-${name}.js`),
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.6/dist/sweetalert2.all.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_ASSETS);
        await Promise.all(['./logo.jpg', './payslip%20logo.jpg'].map(asset => cache.add(asset).catch(() => {})));
        const vendors = await caches.open(VENDOR_CACHE);
        await Promise.all(VENDORS.map(async asset => {
            if (await vendors.match(asset)) return;
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
            try {
                const response = await fetch(asset, {signal:controller.signal});
                if (response.ok) await vendors.put(asset, response);
            } catch {} finally { clearTimeout(timer); }
        }));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('takodeal-manager-core-') && key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET') return;
    const local = url.origin === self.location.origin;
    const navigation = local && request.mode === 'navigate' && [new URL('./', self.location.href).pathname, new URL('./index.html', self.location.href).pathname].includes(url.pathname);
    const vendor = VENDORS.includes(url.href) || url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/10\.8\.1\/[\w.-]+\.js$/.test(url.pathname);
    const core = local && CORE_ASSETS.some(asset => new URL(asset, self.location.href).pathname === url.pathname);
    const image = request.destination === 'image' && (local || !/googleapis\.com|firebase/.test(url.hostname));
    // Only static app files and public images are cached. Auth/API requests pass through.
    if (!core && !vendor && !image && !navigation) return;
    event.respondWith((async () => {
        const cache = await caches.open(vendor ? VENDOR_CACHE : image ? IMAGE_CACHE : CACHE_NAME);
        const lookup = navigation ? new URL('./index.html', self.location.href).href : request;
        const saved = await cache.match(lookup, {ignoreSearch:core || image});
        // Core generations update with the worker. Reopening never refetches every file.
        if (saved) return saved;
        try {
            const response = await fetch(request);
            if (response.ok || response.type === 'opaque') await cache.put(lookup, response.clone()).catch(() => {});
            return response;
        } catch {
            if (image) return new Response('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="150" fill="#f5f7f3"/></svg>', {headers:{'Content-Type':'image/svg+xml'}});
            return new Response('Reconnect once to save this app file on your device.', {status:503});
        }
    })());
});
