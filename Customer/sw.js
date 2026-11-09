const CUSTOMER_RELEASE = 'customer-security-reviews-20261109';
// Customer app installation support. Live ordering always uses the network.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
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
    if(event.request.method!=='GET' || event.request.mode!=='navigate' || url.origin!==self.location.origin || privateTraffic(event.request,url))return;
    event.respondWith(fetch(event.request).catch(()=>new Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAKODEÁL · Connect to continue</title><style>body{margin:0;padding:40px 24px;font:16px/1.7 system-ui;background:#f7f8f4;color:#173f35}main{max-width:440px;margin:auto}a{display:inline-block;padding:12px 18px;background:#173f35;color:white;border-radius:9px;text-decoration:none}</style></head><body><main><h1>Connect to keep ordering</h1><p>TAKODEÁL needs an internet connection to check branch availability and submit your order.</p><p>Reconnect, then reopen the app. No order was submitted from this screen.</p><a href="./">Try again</a></main></body></html>',
        {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
    )));
});
