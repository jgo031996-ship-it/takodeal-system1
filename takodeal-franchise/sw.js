// sw.js - Basic Service Worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (e) => { /* Leave blank to let network handle fetches */ });
