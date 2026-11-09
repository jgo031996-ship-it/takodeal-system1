const CACHE_NAME = 'takodeal-staff-v50-security-loans-20261109';
const SHELL = ['./', './index.html', './style.css', './staff-theme.css', './app.js', './staff-portal.js', './staff-location.js', './staff-registration.js', './staff-phone.js', './app-update.js', './staff-privacy.js', './payroll-safety.js','./schedule-history.js', './logo.jpg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './manifest.json'];
SHELL.push('./schedule-swap-model.js','./staff-swap-request.js');
SHELL.push('./worked-shift-reference.js');
SHELL.push('./payroll-confirmed-shifts.js');
SHELL.push('./payroll-bonus-templates.js');
SHELL.push('./attendance-schedule-preview.js');
SHELL.push('./attendance-shift-declaration.js','./attendance-shift-declaration-ui.js');
SHELL.push('./staff-setup-access.js','./staff-setup.css');
SHELL.push('./sanction-schedule.js');
SHELL.push('./time-out-request-display.js');
SHELL.push('./online-refund-pay.js');
SHELL.push('./payroll-deduction-details.js');
SHELL.push('./attendance-reconcile.js','./attendance-proof.js');
SHELL.push('./staff-document-broker.js');
SHELL.push('./document-metadata-client.js');
SHELL.push('./payroll-attendance.js');
SHELL.push('./staff-payroll-reader.js');
SHELL.push('./staff-rate-privacy.js','./staff-documents.js','./staff-documents.css','./staff-document-model.js','./staff-document-store.js','./staff-document-firebase.js','./attendance-camera.js','./attendance-camera.css');
SHELL.push('./deduction-inbox.js','./deduction-inbox.css');
SHELL.push('./schedule-sync.js','./schedule-view-sync.js');
SHELL.push('./leave-model.js','./leave-request-actions.js','./staff-leave-ui.js','./leave-ui.css');
SHELL.push('./attendance-amendment-review-model.js','./attendance-metadata-reader.js','./onboarding-model.js','./onboarding-service.js','./onboarding-ui.js','./onboarding.css');
SHELL.push("./relief-attendance-model.js","./relief-schedule-review-model.js");
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key === 'takodeal-v1' || (key.startsWith('takodeal-staff-v') && key !== CACHE_NAME)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// API, account and private evidence traffic never enters an app-file cache.
function publicCatalogImage(url) {
  const base='/v0/b/takodeal-pos.firebasestorage.app/o/';
  if(url.hostname!=='firebasestorage.googleapis.com'||!url.pathname.startsWith(base)||url.searchParams.get('alt')!=='media')return false;
  try{return /^(menu_images|inventory_images|storefronts)\//.test(decodeURIComponent(url.pathname.slice(base.length)));}catch{return false;}
}
function privateTraffic(request,url) {
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return true;}
  if(url.username||url.password||request.headers?.has?.('authorization')||/(?:^|\/)api(?:\/|$)|\/__(?:\/|$)/i.test(pathname))return true;
  if(url.hostname==='accounts.google.com')return true;
  const catalog=request.destination==='image'&&publicCatalogImage(url);
  if(/(^|\.)(googleapis\.com|googleusercontent\.com|firebaseio\.com|firebaseapp\.com|cloudfunctions\.net|run\.app)$/i.test(url.hostname)&&!catalog)return true;
  if(!catalog&&[...url.searchParams.keys()].some(key=>/^(token|access_token|id_token|authorization|signature|sig|x-amz-signature|x-goog-signature)$/i.test(key)))return true;
  return false;
}
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || privateTraffic(event.request,url)) return;
    // Never cache staff API requests, payroll responses, or third-party traffic.
    const root=new URL('./',self.location.href),navigation=event.request.mode==='navigate'&&[root.pathname,new URL('./index.html',root).pathname].includes(url.pathname);
    if (!navigation && !SHELL.some(path => new URL(path,root).pathname === url.pathname)) return;
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

SHELL.push("./shift-amendments.js");

SHELL.push('./staff-rate-model.js','./early-time-out-model.js','./early-time-out-actions.js','./early-time-out-ui.js');

SHELL.push('./clock-out-schedule.js');

SHELL.push('./attendance-schedule-reader.js','./attendance-transaction-reader.js');

SHELL.push('./emergency-shift-model.js');

SHELL.push('./owner-deduction-model.js','./staff-lifecycle-model.js','./staff-owner-deductions.js');

SHELL.push('./saved-shift-proposal.js','./payroll-adjustment-model.js','./payroll-recovery-model.js','./staff-payroll-adjustments.js');

SHELL.push('./payroll-vault-freshness.js');

SHELL.push('./payroll-adjustment-history.js');
SHELL.push('./staff-vault-recovery.js','./staff-vault-recovery-ui.js','./staff-payslip-snapshot.js','./staff-saved-payslips.js');

// Install the complete local module graph for this release. API traffic stays online.
SHELL.push("./staff-access.js","./staff-announcements.js","./staff-loan-ledger-client.js","./staff-loan-ledger-model.js","./staff-loan-ledger-ui.js","./staff-loan-ledger.css","./staff-operational-records.js","./staff-pin-proof.js","./staff-private-profile.js");
