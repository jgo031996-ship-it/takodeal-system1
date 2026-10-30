const CACHE_NAME = 'takodeal-manager-core-v109-payroll-timeout-repair-20261030';
const VENDOR_CACHE = 'takodeal-manager-vendors-v1';
const IMAGE_CACHE = 'takodeal-manager-images-v1';
const CORE_ASSETS = ['./', './index.html', './main.js', './franchise-workspace.js', './monthly-bills.js', './monthly-bills-ui.js', './device-fleet.js', './app-update.js', './employee-id.js', './employee-id.css', './payslip.css', './schedule-layout.js', './request-history.js', './schedule-layout.css', './login.css', './login-ui.js', './unlock-gate.js', './device-store.js', './manager-libraries.js', './branch-operations.js', './cash-settlement.js', './shift-close-ui.js', './collection-cache.js', './manager-dialogs.js', './manager-workspace.js', './manager-workspace.css', './dispatch-safety.js', './menu-bulk.js', './pos-safety.js', './recipe-integrity.js', './live-report.js', './payroll-safety.js', './dashboard.js', './dashboard-data.js', './dashboard.css', './manager-theme.css', './manager-theme.js', './manager-scroll.js', './firebase-core.js', './auth.js', './style.css', './manifest.json'];
CORE_ASSETS.push('./staff-setup-codes.js','./staff-setup-codes.css');
CORE_ASSETS.push('./owner-app-update.js','./owner-update-notice.js');
CORE_ASSETS.push('./login-update.js');
CORE_ASSETS.push('./owner-dialogs.css');
CORE_ASSETS.push('./staff-lifecycle-model.js');
CORE_ASSETS.push('./early-time-out-message-templates.js');
CORE_ASSETS.push('./time-out-request-display.js');
CORE_ASSETS.push('./schedule-workspace.js','./schedule-workspace.css');
CORE_ASSETS.push('./logistics-feed.js','./dispatch-restock-model.js','./dispatch-restock-finance.js','./dispatch-restock-ui.js','./dispatch-set-aside.js','./dispatch-request-draft.js','./dispatch-destination-repair.js');
CORE_ASSETS.push('./franchise-dispatch-pricing.js','./franchise-supply-model.js');
CORE_ASSETS.push('./staff-rate-changes.js','./staff-document-hq.js','./staff-documents.js','./staff-documents.css','./staff-document-model.js','./staff-document-store.js','./staff-document-firebase.js');
CORE_ASSETS.push('./attendance-reconcile.js','./payroll-attendance.js');
CORE_ASSETS.push('./remittance-dialogs.css');
CORE_ASSETS.push('./discipline-cases.css','./discipline-case-model.js','./discipline-actions.js','./discipline-case-ui.js');
CORE_ASSETS.push('./payroll-roster-model.js','./payroll-balance-review.js','./payroll-balance-review.css');
CORE_ASSETS.push('./payroll-loading.js','./payroll-settlement.js','./payroll-completion.js','./manager-table-wrapper.js');
CORE_ASSETS.push('./payroll-deduction-details.js');
CORE_ASSETS.push('./recipe-bulk-model.js','./recipe-bulk.js','./recipe-changes.js','./sanction-schedule.js','./sanction-actions.js','./sanction-scheduling-ui.js');
CORE_ASSETS.push('./audit-modal.css','./audit-modal-layout.js','./manager-mobile.css');
CORE_ASSETS.push('./cloud-connection-notice.js','./firestore-health.js','./schedule-recovery-draft.js','./schedule-proposal-model.js','./schedule-proposal-review.js','./schedule-proposal-review-ui.js','./schedule-proposal-review.css');
const VENDORS = [
    ...['app','auth','firestore','storage'].map(name => `https://www.gstatic.com/firebasejs/13.1.0/firebase-${name}.js`),
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.6/dist/sweetalert2.all.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];
CORE_ASSETS.push('./ai-hub.js', './ai-hub-model.js', './ai-hub.css');
CORE_ASSETS.push('./access-workspace.js', './access-workspace-model.js', './access-workspace.css');
CORE_ASSETS.push('./workspace-access-model.js','./workspace-access.js');
CORE_ASSETS.push('./hq-access-sync.js');
CORE_ASSETS.push('./hq-account-reader.js');
CORE_ASSETS.push('./owner-time-out-correction.js','./owner-time-out-correction-ui.js','./owner-time-out-correction.css');
CORE_ASSETS.push('./dispatch-cart.css','./government-permits.js','./government-permits-model.js','./government-permits-service.js','./government-permits.css','./owner-record-files.js','./bookkeeper-payments.js','./bookkeeper-payments.css','./staff-sss-model.js','./staff-sss-service.js','./staff-sss-ui.js','./staff-sss.css');
CORE_ASSETS.push('./staff-document-broker.js');
CORE_ASSETS.push('./remittance-review.js','./schedule-history.js','./schedule-memory-ui.js','./schedule-memory.css','./attendance-audit.js','./schedule-swap-review.js');
CORE_ASSETS.push('./hq-account-model.js','./hq-profile.js','./pos-config-model.js','./pos-config-workspace.js','./pos-config-workspace.css');
CORE_ASSETS.push('./online-refunds.js','./online-refunds-ui.js','./online-refunds.css');
CORE_ASSETS.push('./customer-site-settings.js','./customer-hub-settings.js','./customer-hub-settings.css');
CORE_ASSETS.push('./stock-cycle.js','./refund-payroll.js');
CORE_ASSETS.push('./financial-flow-model.js','./financial-flow-ui.js','./financial-flow.css');
CORE_ASSETS.push('./inventory-editor.js','./inventory-editor-actions.js','./inventory-item-edit-model.js','./inventory-overview.js','./inventory-editor.css');
CORE_ASSETS.push('./inventory-stock-forms.js','./inventory-stock-forms.css','./inventory-stock-form-model.js','./inventory-stock-form-actions.js','./inventory-yield.js','./inventory-workspace.css','./inventory-intelligence.js','./inventory-intelligence-model.js','./inventory-intelligence-reader.js','./inventory-history-workspace.js','./inventory-history-workspace.css','./inventory-history-model.js','./inventory-history-services.js');
CORE_ASSETS.push('./inventory-intelligence.css');
CORE_ASSETS.push('./inventory-waste-form.js');
CORE_ASSETS.push('./schedule-sync.js','./owner-schedule-sync.js');
CORE_ASSETS.push('./schedule-staff-directory.js','./schedule-relief-staff.js','./late-request-summary.js','./late-request-resolution.js');
CORE_ASSETS.push('./payroll-preview-guard.js');
CORE_ASSETS.push('./leave-model.js','./leave-request-actions.js','./leave-schedule-actions.js','./manager-leave-ui.js','./leave-ui.css','./pos-settings-policy.js','./pos-settings-policy.css','./owner-pos-settings-access.js');
CORE_ASSETS.push('./franchise-hq-ui.js','./franchise-hq-model.js','./franchise-hq-actions.js');
CORE_ASSETS.push('./hr-review-ui.js','./hr-review.css','./attendance-amendment-review.js','./attendance-amendment-review-model.js','./onboarding-model.js','./onboarding-owner.js','./attendance-metadata-reader.js');
CORE_ASSETS.push('./staff-directory-reader.js','./payment-review-scanner.js');
self.addEventListener('message', event => {
    if(event.data?.type!=='OWNER_RELEASE_CHECK')return;
    try{event.ports?.[0]?.postMessage({type:'OWNER_RELEASE',release:CACHE_NAME});}catch{}
});
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Overlapping feature lists can name the same file. Cache.addAll rejects
        // duplicate requests and would leave the previous app generation active.
        await cache.addAll([...new Set(CORE_ASSETS)]);
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
    const vendor = VENDORS.includes(url.href) || url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/13\.1\.0\/[\w.-]+\.js$/.test(url.pathname);
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

CORE_ASSETS.push('./rider-delivery-safety.js','./rider-management.js','./rider-management-view.js','./rider-management.css');
CORE_ASSETS.push('./menu-options-model.js','./menu-options-service.js','./menu-options-ui.js','./menu-options.css','./product-editor-layout.js','./product-editor-layout.css','./product-options-draft.js');
CORE_ASSETS.push('./bundle-category-model.js','./bundle-category-ui.js','./bundle-category.css');

CORE_ASSETS.push('./stock-request-review.js','./stock-request-review.css','./stock-report-units.js','./dispatch-request-draft.js');

CORE_ASSETS.push("./operations-model.js","./operations-manager.js","./operations-upgrade.css","./mobile-delivery-settings.js","./franchise-supply-pricing.js","./franchise-cost-model.js");

CORE_ASSETS.push("./shift-amendments.js","./shift-amendment-ui.js","./payroll-schedule-freshness.js");

CORE_ASSETS.push('./staff-rate-model.js','./early-time-out-model.js','./early-time-out-actions.js','./early-time-out-ui.js','./early-time-out-review.js','./early-time-out-review-ui.js','./early-time-out-review.css','./notice-form.css','./notice-form-layout.js');

CORE_ASSETS.push('./staff-salary-date-ui.js','./staff-salary-date-ui.css');

CORE_ASSETS.push('./sop-checklist-export-service.js','./sop-checklist-export-ui.js','./sop-checklist-pdf.js','./sop-checklist-model.js');

CORE_ASSETS.push('./clock-out-schedule.js');

CORE_ASSETS.push('./attendance-schedule-reader.js','./attendance-transaction-reader.js','./owner-inbox.js');

CORE_ASSETS.push('./emergency-shift-model.js');
CORE_ASSETS.push('./cash-shortage.js','./cash-shortage-model.js','./cash-shortage-ui.js','./cash-shortage.css');

CORE_ASSETS.push('./shift-closer-display.js');

CORE_ASSETS.push('./cash-remittance-client.js','./cash-remittance-review-ui.js','./cash-remittance-review.css','./cash-remittance-model.js');

CORE_ASSETS.push('./recipe-cost-model.js','./recipe-cost-ui.js','./recipe-cost-ui.css');

CORE_ASSETS.push('./platform-price-comparison.js','./platform-payout-summary.js','./platform-comparison-reader.js');
