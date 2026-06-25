const CACHE_NAME = "takodeal-pos-core-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./main.js",
  "./logo.jpg",
  "./manifest.json"
];

// 1. INSTALLATION: Save files to the tablet's hard drive
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("📦 Caching Core App Files for Offline Use...");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATION: Clean up old caches to save space
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log("🧹 Clearing old cache...");
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. INTERCEPTOR: The "No Internet" Shield
self.addEventListener("fetch", event => {
  // Ignore Firebase database requests (Firebase handles its own offline cache)
  if (event.request.url.includes("firestore.googleapis.com") || event.request.url.includes("firebasestorage")) {
    return;
  }

  event.respondWith(
    // Always try the network first (so you get updates if you change code)
    fetch(event.request).catch(() => {
      // If the internet drops or gives ERR_NETWORK_CHANGED, grab it from the hard drive!
      console.log("📶 Network failed. Serving from Tablet Hard Drive.");
      return caches.match(event.request);
    })
  );
});
