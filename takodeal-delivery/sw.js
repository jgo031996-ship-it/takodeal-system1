const CACHE_NAME = 'rider-app-v4-protected-access-20261109';
const urlsToCache = [
  './',
  './index.html',
  './main.js',
  './Delivery.jpg',
  './manifest.json',
  './rider-mobile.css',
  './rider-layout.js',
  './rider-account-model.js',
  './rider-account.js',
  './rider-dispatch-view.js',
  './rider-delivery-safety.js'
];

// Install the service worker and cache the files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate only after the previous app has closed. Never cache business or auth traffic.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('rider-app-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
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
  const url = new URL(event.request.url), root = new URL('./', self.location.href);
  if (event.request.method !== 'GET' || url.origin !== root.origin || privateTraffic(event.request,url)) return;
  const staticPaths = urlsToCache.map(path => new URL(path, root).pathname);
  if (!staticPaths.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
      return response;
    } catch {
      return await cache.match(event.request, { ignoreSearch: true }) || Response.error();
    }
  })());
});

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());});

// Install the complete local module graph for this release. API traffic stays online.
urlsToCache.push("./rider-access-client.js","./rider-photo-upload.js");
