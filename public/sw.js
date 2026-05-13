self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Ismuscle GTG', {
      body: data.body || '1 rep — forme parfaite',
      icon: data.icon || '/icon.png',
      badge: data.badge || '/icon.png',
      tag: data.tag || 'gtg',
      vibrate: [100, 50, 100, 50, 200],
      requireInteraction: false,
      data: data.data || {}
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(cls => {
      if (cls.length > 0) {
        cls[0].focus();
        cls[0].postMessage({type:'GTG_NOTIF_CLICK', data: e.notification.data});
      } else {
        clients.openWindow('/');
      }
    })
  );
});

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
