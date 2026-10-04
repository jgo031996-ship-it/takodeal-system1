// In Cashier sw.js, REPLACE ONLY its existing line starting const CORE =
// with this line. Do not add a second const CORE. Keep PHOTOS unchanged.
const CORE = 'takodeal-pos-core-final-shift-20261004';
const PHOTOS = 'takodeal-pos-photos-offline02';
const ROOT = new URL('./', self.location.href);
const required = ['./', './index.html', './main.js', './branch-operations.js','./cash-settlement.js','./shift-close-ui.js', './dispatch-safety.js', './pos-checkout.js', './pos-safety.js', './pos-ui-v2.css', './pos-ui-v2.js', './manifest.json'];
const sdk = 'https://www.gstatic.com/firebasejs/10.8.1/';
const libraries = [sdk + 'firebase-app.js', sdk + 'firebase-firestore.js', sdk + 'firebase-auth.js', sdk + 'firebase-storage.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'];
const trustedLibrary = url => url.startsWith(sdk) || url.startsWith('https://cdn.jsdelivr.net/');
const MODEL_ROOT = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/';
const modelNames = ['ssd_mobilenetv1', 'face_landmark_68', 'face_recognition'];
async function fetchRequired(cache, url) {
  const response = await fetch(new Request(url, { cache: 'reload', mode: 'cors' }));
  if (!response.ok || response.type === 'opaque') throw new Error('Required app file unavailable: ' + url);
  await cache.put(url, response.clone());
  return response;
}
async function prepareApp() {
  const cache = await caches.open(CORE);
  const seen = new Set();
  async function load(url) {
    if (seen.has(url)) return;
    seen.add(url);
    if (seen.size > 100) throw new Error('Unexpected dependency graph');
    const response = await fetchRequired(cache, url);
    if (url.startsWith(sdk) && /\.js(?:\?|$)/.test(url)) {
      const source = await response.text();
      const dependencies = [...source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)]
        .map(match => new URL(match[1], url).href).filter(value => value.startsWith(sdk));
      for (const dependency of dependencies) await load(dependency);
    }
  }
  for (const path of required) await load(new URL(path, ROOT).href);
  for (const url of libraries) await load(url);
  // Existing UI may use either logo. These do not prevent installing the app.
  for (const path of ['./logo.jpg', './logo.png', './style.css'])
    await fetchRequired(cache, new URL(path, ROOT).href).catch(() => {});
}
self.addEventListener('install', event => {
  // A failed dependency download leaves the preceding worker in use.
  event.waitUntil(prepareApp().then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Keep preceding caches until the owner has tested the new installation.
  // Never clear IndexedDB or the sale ledger during a worker update.
  event.waitUntil(self.clients.claim());
});
async function savePhoto(cache, value) {
  const url = new URL(value, ROOT);
  if (url.protocol === 'data:') return;
  if (url.protocol === 'blob:') throw new Error('Temporary image URL cannot survive an app restart');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid image URL');
  if (await cache.match(url.href)) return;
  let response;
  try { response = await fetch(new Request(url.href, { mode: 'cors' })); }
  catch { response = await fetch(new Request(url.href, { mode: 'no-cors' })); }
  if (!response.ok && response.type !== 'opaque') throw new Error('Image download failed');
  // Exact URL retains Firebase Storage tokens and all other query parameters.
  await cache.put(url.href, response);
}
async function prepareModels() {
  const cache = await caches.open(CORE);
  for (const name of modelNames) {
    const url = MODEL_ROOT + name + '_model-weights_manifest.json';
    let manifest = await cache.match(url);
    if (!manifest) manifest = await fetchRequired(cache, url);
    const groups = await manifest.json();
    if (!Array.isArray(groups)) throw new Error('Invalid attendance model manifest');
    for (const group of groups) for (const path of group.paths || []) {
      const shard = new URL(path, MODEL_ROOT).href;
      if (!shard.startsWith(MODEL_ROOT)) throw new Error('Invalid attendance model path');
      if (!(await cache.match(shard))) await fetchRequired(cache, shard);
    }
  }
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'TK_PREPARE_OFFLINE' || !event.ports?.[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(PHOTOS);
      const failed = [], photos = [...new Set(event.data.photos || [])];
      // Small groups avoid hundreds of simultaneous photo downloads on tablets.
      for (let start = 0; start < photos.length; start += 4) {
        const group = photos.slice(start, start + 4);
        const result = await Promise.allSettled(group.map(url => savePhoto(cache, url)));
        result.forEach((entry, index) => { if (entry.status === 'rejected') failed.push(group[index]); });
      }
      if (event.data.models === true) await prepareModels();
      port.postMessage({ ok: true, failed, saved: photos.length - failed.length, modelsComplete: event.data.models === true });
    } catch (error) { port.postMessage({ ok: false, error: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin === ROOT.origin && url.pathname.startsWith(ROOT.pathname + 'api/')) return;
  // Handle images FIRST, including firebasestorage.googleapis.com images.
  if (request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(PHOTOS), cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        try { await cache.put(request, response.clone()); } catch { /* Owner preparation reports quota failures. */ }
      }
      return response;
    })());
    return;
  }
  const localAsset = url.origin === ROOT.origin && url.pathname.startsWith(ROOT.pathname) &&
    (request.mode === 'navigate' || /\.(html|js|css|json|jpg|png|svg|woff2?)(?:$)/i.test(url.pathname));
  if (!localAsset && !trustedLibrary(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CORE);
    // Only known local app files ignore the release query string. SDK imports
    // and all remote URLs use their full, versioned URL.
    const cached = await cache.match(request, localAsset ? { ignoreSearch: true } : {});
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
    return response;
  })());
});
