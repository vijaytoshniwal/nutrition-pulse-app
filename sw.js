const cacheName = 'nutrition-pulse-v2-36';
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
  './src/diet-plan.js',
  './src/meal-timing.js',
  './src/firebase-sync.js',
  './src/image-hash.js',
  './src/alerts.js',
  './src/notifications.js',
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

// Push handler — ready for a future push server (FCM/Web Push). Not subscribed
// yet, so this only fires once a server is wired up; harmless until then.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Nutrition Pulse';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: data.tag || 'nutrition-pulse',
    data: { url: data.url || './' },
  }));
});

// Tapping a notification focuses an open tab, or opens the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => 'focus' in c);
      if (existing) return existing.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
