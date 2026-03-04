const CACHE_NAME = 'tradeiq-v1';
const OFFLINE_URL = '/';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png'
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
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || caches.match(OFFLINE_URL);
        });
      })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const actions = data.actions || [
    { action: 'view', title: 'View Signal' },
    { action: 'dismiss', title: 'Dismiss' }
  ];

  const options = {
    body: data.body || 'New trading signal available',
    icon: '/favicon.png',
    badge: '/favicon.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'trade-signal',
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/signals',
      signalId: data.signalId,
      tradeAction: data.tradeAction || null,
      tradeId: data.tradeId || null,
      instrument: data.instrument || null,
      direction: data.direction || null,
      timeframe: data.timeframe || null
    },
    actions: actions
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'TradeIQ Signal', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const data = event.notification.data || {};
  let urlToOpen = data.url || '/';

  if (event.action === 'take_trade' || data.tradeAction === 'confirm') {
    if (data.tradeId) {
      urlToOpen = '/?confirmTrade=' + data.tradeId;
    } else if (data.instrument) {
      urlToOpen = '/?confirmSignal=' + data.instrument + '&tf=' + (data.timeframe || '') + '&dir=' + (data.direction || '');
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});
