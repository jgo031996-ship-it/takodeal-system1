const CACHE = 'takodeal-franchise-v17-auto-branches-20261113-r1';
const CORE=['./','index.html','style.css','main_franchise.js','auth.js','franchise-data.js','franchise-actions.js','franchise-workspace.js','payroll-safety.js','schedule-history.js','dispatch-safety.js','unlock-gate.js','hq-account-model.js','manifest.json','logo.jpg','icon-192.png','icon-512.png'];
CORE.push('./worked-shift-reference.js');
CORE.push('franchise-ai-board.js','franchise-ai-board.css');
CORE.push('emergency-shift-model.js');
CORE.push('franchise-payroll-confirmations.js','payroll-confirmed-shifts.js','attendance-metadata-reader.js');
CORE.push('franchise-reads.js','franchise-item-picker.js','franchise-item-picker.css','franchise-payroll-controls.js','franchise-payroll-controls.css');
CORE.push('attendance-reconcile.js','payroll-attendance.js');
CORE.push('sanction-schedule.js');
CORE.push('sanction-actions.js','sanction-scheduling-ui.js','workspace-access-model.js');
CORE.push('schedule-sync.js','schedule-view-sync.js');
CORE.push('franchise-hq-ui.js','franchise-hq-model.js','franchise-hq-actions.js','franchise-hq.css');
CORE.push('attendance-amendment-review-model.js');
CORE.push("relief-attendance-model.js","relief-schedule-review-model.js");
CORE.push('./payroll-bonus-templates.js');
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('takodeal-franchise-') && key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
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
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Only static assets belonging to this app are cached. HQ, auth and business reads stay online.
 if(event.request.method!=='GET' || privateTraffic(event.request,url) || url.origin!==self.location.origin || !url.pathname.startsWith(new URL('./',self.location.href).pathname))return;
 if(!CORE.some(file=>new URL(file,self.location.href).pathname===url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>await caches.match(event.request,{ignoreSearch:true}) || Response.error()));
});

CORE.push("operations-model.js","franchise-cost-model.js","franchise-supply-actions.js","franchise-staff-actions.js","staff-rate-changes.js");

CORE.push("shift-amendments.js");

CORE.push('staff-rate-model.js');
CORE.push('discipline-case-model.js','franchise-discipline-model.js','franchise-discipline-actions.js','franchise-discipline-ui.js','franchise-discipline.css','franchise-payroll-model.js','franchise-payslip-ui.js','franchise-supply-model.js','franchise-supply-ui.js','franchise-supply.css');
CORE.push('franchise-dispatch-pricing.js');
CORE.push('dispatch-restock-model.js');
CORE.push('stock-audit-model.js','stock-audit-reader.js','stock-audit-ui.js','stock-audit-ui.css');

CORE.push('./live-branch-directory.js');
