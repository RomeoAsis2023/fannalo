const CACHE_NAME = 'fannalo-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/404.html',
  '/assets/css/main.css',
  '/assets/css/admin.css',
  '/assets/js/app.js',
  '/assets/js/core/preload.js',
  '/assets/js/core/db.js',
  '/assets/js/core/p2p.js',
  '/assets/js/core/auth.js',
  '/assets/js/core/wallet.js',
  '/assets/js/core/torrent.js',
  '/assets/js/core/superpeer.js',
  '/assets/js/core/chat.js',
  '/assets/js/core/video.js',
  '/assets/js/core/live.js',
  '/assets/js/features/feed.js',
  '/assets/js/features/profile.js',
  '/assets/js/features/notifications.js',
  '/assets/js/features/earnings.js',
  '/assets/js/features/events.js',
  '/assets/js/features/analytics.js',
  '/assets/js/features/stories.js',
  '/assets/js/admin/dashboard.js',
  '/assets/img/full_logo.png',
  '/assets/img/icon.png',
  '/assets/img/icon_transparent.png',
  '/pages/login.html',
  '/pages/register.html',
  '/pages/forgot-password.html',
  '/pages/feed.html',
  '/pages/profile.html',
  '/pages/wallet.html',
  '/pages/notifications.html',
  '/pages/chat.html',
  '/pages/video-call.html',
  '/pages/live.html',
  '/pages/events.html',
  '/pages/calendar.html',
  '/pages/analytics.html',
  '/pages/withdraw.html',
  '/pages/earnings.html',
  '/pages/stories.html',
  '/pages/admin/dashboard.html',
  '/pages/admin/users.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
