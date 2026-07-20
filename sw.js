const cacheName = 'nutrition-pulse-v2-25';
const assets = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './src/constants.js',
  './src/utils.js',
  './src/state.js',
  './src/calculations.js',
  './src/food-lookup.js',
  './src/food-db.js',
  './src/firebase-sync.js',
  './src/image-hash.js',
  './src/alerts.js',
  './src/barcode.js',
  './src/activity-ocr.js',
];

self.addEventListener('install', event => {
  // Activate the new version immediately instead of waiting for every tab to
  // close — otherwise phones keep serving the previous cached version.
  self.skipWaiting();
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== cacheName).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
