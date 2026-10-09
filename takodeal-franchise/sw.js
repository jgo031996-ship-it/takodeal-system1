const CACHE='takodeal-franchise-workspace-staff-pos-repair-20261008-r12';
const CORE=['./','index.html','style.css','main_franchise.js','auth.js','franchise-data.js','franchise-actions.js','franchise-workspace.js','payroll-safety.js','schedule-history.js','dispatch-safety.js','unlock-gate.js','hq-account-model.js','manifest.json','logo.jpg','icon-192.png','icon-512.png'];
CORE.push('franchise-reads.js');
CORE.push('attendance-reconcile.js','payroll-attendance.js');
CORE.push('sanction-schedule.js');
CORE.push('sanction-actions.js','sanction-scheduling-ui.js','workspace-access-model.js');
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('takodeal-franchise-') && key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Only static assets belonging to this app are cached. HQ, auth and business reads stay online.
 if(event.request.method!=='GET' || url.origin!==self.location.origin || !url.pathname.startsWith(new URL('./',self.location.href).pathname))return;
 const file=url.pathname.split('/').pop() || './';if(!CORE.includes(file))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>await caches.match(event.request,{ignoreSearch:true}) || Response.error()));
});
